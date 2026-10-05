<?php

declare(strict_types=1);

namespace App\Service;

use PDO;
use Symfony\Component\HttpKernel\KernelInterface;

final class TenantRegistry
{
    private PDO $db;

    public function __construct(KernelInterface $kernel)
    {
        $path = getenv('TEAMPLANER_PLATFORM_DB_PATH') ?: $kernel->getProjectDir().'/var/platform.sqlite';
        $this->db = new PDO('sqlite:'.$path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->db->exec('PRAGMA busy_timeout = 5000');
        $this->db->exec('CREATE TABLE IF NOT EXISTS tenants (
            slug TEXT PRIMARY KEY, name TEXT NOT NULL, billing_email TEXT NOT NULL,
            admin_password_hash TEXT NOT NULL, status TEXT NOT NULL,
            period_start TEXT, period_end TEXT, created_at TEXT NOT NULL
        )');
        $this->db->exec('CREATE TABLE IF NOT EXISTS annual_activations (
            reference TEXT PRIMARY KEY, tenant_slug TEXT NOT NULL,
            period_start TEXT NOT NULL, period_end TEXT NOT NULL, created_at TEXT NOT NULL
        )');
        $this->db->exec('CREATE TABLE IF NOT EXISTS manager_accounts (
            username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
        )');
        chmod($path, 0600);
    }

    public function find(string $slug): ?array
    {
        $statement = $this->db->prepare('SELECT slug, name, billing_email, status, period_start, period_end, created_at FROM tenants WHERE slug = ?');
        $statement->execute([$slug]);
        return $statement->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public function all(): array
    {
        return $this->db->query('SELECT slug, name, billing_email, status, period_start, period_end, created_at FROM tenants ORDER BY created_at DESC')->fetchAll(PDO::FETCH_ASSOC);
    }

    public function managerPasswordHash(string $username): ?string
    {
        $statement = $this->db->prepare('SELECT password_hash FROM manager_accounts WHERE username = ?');
        $statement->execute([$username]);
        $hash = $statement->fetchColumn();
        return $hash === false ? null : $hash;
    }

    public function createManager(string $username, string $password): void
    {
        if (!preg_match('/^[a-z][a-z0-9_-]{2,39}$/', $username)) throw new \DomainException('Manager-Name: 3–40 Kleinbuchstaben, Zahlen, Bindestriche oder Unterstriche.');
        if (strlen($password) < 20) throw new \DomainException('Das Manager-Passwort muss mindestens 20 Zeichen lang sein.');
        try {
            $statement = $this->db->prepare('INSERT INTO manager_accounts (username, password_hash, created_at) VALUES (?, ?, ?)');
            $statement->execute([$username, password_hash($password, PASSWORD_DEFAULT), gmdate('c')]);
        } catch (\PDOException $error) {
            throw new \DomainException('Dieser Manager-Name ist bereits vergeben.', 0, $error);
        }
    }

    public function adminPasswordHash(string $slug): ?string
    {
        $statement = $this->db->prepare('SELECT admin_password_hash FROM tenants WHERE slug = ?');
        $statement->execute([$slug]);
        $hash = $statement->fetchColumn();
        return $hash === false ? null : $hash;
    }

    public function resetAdminPassword(string $slug, string $password): void
    {
        if ($this->find($slug) === null) throw new \DomainException('Organisation nicht gefunden.');
        if (strlen($password) < 12 || strlen($password) > 200) throw new \DomainException('Das Admin-Passwort muss 12 bis 200 Zeichen lang sein.');
        $statement = $this->db->prepare('UPDATE tenants SET admin_password_hash = ? WHERE slug = ?');
        $statement->execute([password_hash($password, PASSWORD_DEFAULT), $slug]);
    }

    public function create(string $slug, string $name, string $email, string $password): array
    {
        $slug = strtolower(trim($slug));
        $name = trim($name);
        $email = strtolower(trim($email));
        if (in_array($slug, ['legacy', 'login', 'logout', 'manager', 'registrieren', 'abo', 'api'], true) || !preg_match('/^[a-z0-9][a-z0-9-]{2,39}$/', $slug)) {
            throw new \DomainException('Organisationskürzel: 3–40 Kleinbuchstaben, Zahlen oder Bindestriche.');
        }
        if ($name === '' || mb_strlen($name) > 100) throw new \DomainException('Bitte einen Organisationsnamen bis 100 Zeichen eingeben.');
        if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) throw new \DomainException('Bitte eine gültige Kontakt-E-Mail angeben.');
        if (strlen($password) < 12 || strlen($password) > 200) throw new \DomainException('Das Admin-Passwort muss 12 bis 200 Zeichen lang sein.');
        if ($this->find($slug) !== null) throw new \DomainException('Dieses Organisationskürzel ist bereits vergeben.');
        $statement = $this->db->prepare('INSERT INTO tenants (slug, name, billing_email, admin_password_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
        try {
            $statement->execute([$slug, $name, $email, password_hash($password, PASSWORD_DEFAULT), 'pending', gmdate('c')]);
        } catch (\PDOException $error) {
            throw new \DomainException('Dieses Organisationskürzel ist bereits vergeben.', 0, $error);
        }
        return $this->find($slug);
    }

    public function canWrite(string $slug): bool
    {
        if ($slug === 'legacy') return true;
        $tenant = $this->find($slug);
        return $tenant !== null && $tenant['status'] === 'active' && $tenant['period_end'] !== null && $tenant['period_end'] > gmdate('c');
    }

    public function activateAnnual(string $slug, string $reference): array
    {
        $reference = trim($reference);
        if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/', $reference)) {
            throw new \DomainException('Rechnungsreferenz: 3–80 Buchstaben, Zahlen, Punkt, Bindestrich oder Unterstrich.');
        }
        $this->db->exec('BEGIN IMMEDIATE');
        try {
            $tenant = $this->find($slug);
            if ($tenant === null) throw new \DomainException('Organisation nicht gefunden.');
            $statement = $this->db->prepare('SELECT tenant_slug FROM annual_activations WHERE reference = ?');
            $statement->execute([$reference]);
            $previous = $statement->fetchColumn();
            if ($previous !== false) {
                if ($previous !== $slug) throw new \DomainException('Diese Rechnungsreferenz gehört bereits zu einer anderen Organisation.');
                $this->db->exec('COMMIT');
                return $tenant;
            }
            $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
            $end = $tenant['period_end'] !== null ? new \DateTimeImmutable($tenant['period_end']) : $now;
            $start = $end > $now ? $end : $now;
            $newEnd = $start->modify('+1 year');
            $visibleStart = $end > $now && $tenant['period_start'] !== null ? $tenant['period_start'] : $now->format('c');
            $statement = $this->db->prepare('UPDATE tenants SET status = ?, period_start = ?, period_end = ? WHERE slug = ?');
            $statement->execute(['active', $visibleStart, $newEnd->format('c'), $slug]);
            $statement = $this->db->prepare('INSERT INTO annual_activations (reference, tenant_slug, period_start, period_end, created_at) VALUES (?, ?, ?, ?, ?)');
            $statement->execute([$reference, $slug, $start->format('c'), $newEnd->format('c'), $now->format('c')]);
            $this->db->exec('COMMIT');
        } catch (\Throwable $error) {
            $this->db->exec('ROLLBACK');
            throw $error;
        }
        return $this->find($slug);
    }
}
