<?php

declare(strict_types=1);

namespace App\Service;

use PDO;
use Symfony\Component\HttpKernel\KernelInterface;

final class PlanStore
{
    private PDO $db;

    public function __construct(
        private readonly KernelInterface $kernel,
        private readonly PlanRules $rules,
        private readonly TenantRegistry $tenants,
        private readonly ?string $tenantSlug = null,
    )
    {
        if ($tenantSlug === null) return;
        if ($tenantSlug === 'legacy') {
            $path = getenv('TEAMPLANER_DB_PATH') ?: $kernel->getProjectDir().'/var/teamplaner.sqlite';
        } else {
            $directory = getenv('TEAMPLANER_TENANTS_DIR') ?: $kernel->getProjectDir().'/var/tenants';
            if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
                throw new \RuntimeException('Mandantenverzeichnis konnte nicht erstellt werden.');
            }
            $path = $directory.'/'.$tenantSlug.'.sqlite';
        }
        $this->db = new PDO('sqlite:'.$path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        chmod($path, 0600);
        $this->db->exec('PRAGMA busy_timeout = 5000');
        $this->db->exec('CREATE TABLE IF NOT EXISTS plan_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, data TEXT NOT NULL)');
        $this->db->exec('CREATE TABLE IF NOT EXISTS swap_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, person_id TEXT NOT NULL,
            replacement_id TEXT NOT NULL, person_shift TEXT, replacement_shift TEXT,
            created_by TEXT NOT NULL, agreed INTEGER NOT NULL, status TEXT NOT NULL,
            created_at TEXT NOT NULL, decided_by TEXT, decided_at TEXT
        )');
        $this->db->exec('CREATE TABLE IF NOT EXISTS employee_accounts (
            person_id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL
        )');
        $statement = $this->db->prepare('INSERT OR IGNORE INTO plan_state (id, revision, data) VALUES (1, 0, ?)');
        $statement->execute([json_encode($tenantSlug === 'legacy' ? $rules->initialState() : $rules->emptyState(), JSON_THROW_ON_ERROR)]);
        $row = $this->stateRow();
        $state = json_decode($row['data'], true, 512, JSON_THROW_ON_ERROR);
        if (!isset($state['shiftTypes']) || !isset($state['staffing']) || array_filter($state['shiftTypes'], static fn (array $type): bool => !isset($type['staffingUnits']))) {
            $state['shiftTypes'] ??= $rules->defaultShiftTypes();
            foreach ($state['shiftTypes'] as &$type) $type['staffingUnits'] ??= in_array($type['code'], ['F', 'T', 'S'], true) ? 1 : 0.5;
            unset($type);
            $state['staffing'] ??= $rules->defaultStaffing();
            $this->writeState((int)$row['revision'], $state);
        }
    }

    public function forTenant(string $slug): self
    {
        if ($slug !== 'legacy' && (!preg_match('/^[a-z0-9][a-z0-9-]{2,39}$/', $slug) || $this->tenants->find($slug) === null)) {
            throw new \DomainException('Organisation nicht gefunden.');
        }
        return new self($this->kernel, $this->rules, $this->tenants, $slug);
    }

    public function snapshot(): array
    {
        $row = $this->stateRow();
        $state = json_decode($row['data'], true, 512, JSON_THROW_ON_ERROR);
        $state['workModel'] ??= $this->rules->defaultWorkModel();
        $state['staffing']['week'] ??= [];
        return ['revision' => (int)$row['revision'], ...$state, 'requests' => $this->requests()];
    }

    public function saveState(int $expectedRevision, array $submitted): array
    {
        $this->db->exec('BEGIN IMMEDIATE');
        try {
            $row = $this->stateRow();
            $this->requireRevision($row, $expectedRevision);
            $before = json_decode($row['data'], true, 512, JSON_THROW_ON_ERROR);
            $state = $this->rules->validateState([
                ...$submitted,
                'shiftTypes' => $submitted['shiftTypes'] ?? $before['shiftTypes'] ?? $this->rules->defaultShiftTypes(),
                'staffing' => $submitted['staffing'] ?? $before['staffing'] ?? $this->rules->defaultStaffing(),
                'workModel' => $submitted['workModel'] ?? $before['workModel'] ?? $this->rules->defaultWorkModel(),
            ]);
            $this->writeState((int)$row['revision'] + 1, $state);
            $activeIds = array_column($state['people'], 'id');
            $deleteAccount = $this->db->prepare('DELETE FROM employee_accounts WHERE person_id = ?');
            foreach (array_diff(array_column($before['people'], 'id'), $activeIds) as $removedId) {
                $deleteAccount->execute([$removedId]);
            }
            if ($before['people'] !== $state['people'] || ($before['shiftTypes'] ?? []) !== $state['shiftTypes']) {
                $this->db->exec("UPDATE swap_requests SET status = 'superseded' WHERE status = 'pending'");
            } else {
                $oldDays = $before['assignments'] ?? [];
                $newDays = $state['assignments'] ?? [];
                $statement = $this->db->prepare("UPDATE swap_requests SET status = 'superseded' WHERE status = 'pending' AND date = ?");
                foreach (array_unique([...array_keys($oldDays), ...array_keys($newDays)]) as $day) {
                    if (($oldDays[$day] ?? null) !== ($newDays[$day] ?? null)) $statement->execute([$day]);
                }
            }
            $this->db->exec('COMMIT');
        } catch (\Throwable $error) {
            $this->db->exec('ROLLBACK');
            throw $error;
        }
        return $this->snapshot();
    }

    public function requestSwap(int $expectedRevision, string $day, string $personId, string $replacementId, bool $agreed, string $username): array
    {
        if (!$agreed) throw new \DomainException('Bitte die Absprache mit der Ersatzperson bestätigen.');
        $this->db->exec('BEGIN IMMEDIATE');
        try {
            $row = $this->stateRow();
            $this->requireRevision($row, $expectedRevision);
            $state = json_decode($row['data'], true, 512, JSON_THROW_ON_ERROR);
            $this->rules->swap($state, $day, $personId, $replacementId);
            $personShift = $state['assignments'][$day][$personId] ?? null;
            $replacementShift = $state['assignments'][$day][$replacementId] ?? null;
            $statement = $this->db->prepare('INSERT INTO swap_requests (date, person_id, replacement_id, person_shift, replacement_shift, created_by, agreed, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)');
            $statement->execute([$day, $personId, $replacementId, $personShift, $replacementShift, $username, 'pending', gmdate('c')]);
            $this->db->exec('COMMIT');
        } catch (\Throwable $error) {
            $this->db->exec('ROLLBACK');
            throw $error;
        }
        return $this->snapshot();
    }

    public function accountByUsername(string $username): ?array
    {
        $statement = $this->db->prepare('SELECT person_id, username, password_hash FROM employee_accounts WHERE username = ?');
        $statement->execute([$username]);
        $account = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$account) return null;
        $people = array_column(json_decode($this->stateRow()['data'], true, 512, JSON_THROW_ON_ERROR)['people'], 'id');
        return in_array($account['person_id'], $people, true) ? $account : null;
    }

    public function accounts(): array
    {
        return $this->db->query('SELECT person_id AS personId, username FROM employee_accounts ORDER BY username COLLATE NOCASE')->fetchAll(PDO::FETCH_ASSOC);
    }

    public function saveAccount(string $personId, string $username, string $password): array
    {
        $username = strtolower(trim($username));
        if ($username === 'admin' || !preg_match('/^[a-z0-9][a-z0-9._-]{2,39}$/', $username)) {
            throw new \DomainException('Benutzername: 3–40 Zeichen, nur Kleinbuchstaben, Zahlen, Punkt, Bindestrich oder Unterstrich.');
        }
        $existing = $this->accountForPerson($personId);
        if ($password === '' && !$existing) throw new \DomainException('Für den neuen Zugang ist ein Passwort erforderlich.');
        if ($password !== '' && strlen($password) < 12) throw new \DomainException('Das Passwort muss mindestens 12 Zeichen lang sein.');
        if (strlen($password) > 200) throw new \DomainException('Das Passwort ist zu lang.');
        $this->db->exec('BEGIN IMMEDIATE');
        try {
            $people = array_column(json_decode($this->stateRow()['data'], true, 512, JSON_THROW_ON_ERROR)['people'], 'id');
            if (!in_array($personId, $people, true)) throw new \DomainException('Diese Person ist nicht im Team.');
            $statement = $this->db->prepare('SELECT person_id FROM employee_accounts WHERE username = ?');
            $statement->execute([$username]);
            $owner = $statement->fetchColumn();
            if ($owner !== false && $owner !== $personId) throw new \DomainException('Dieser Benutzername ist bereits vergeben.');
            $hash = $password === '' ? $existing['password_hash'] : password_hash($password, PASSWORD_DEFAULT);
            $statement = $this->db->prepare('INSERT INTO employee_accounts (person_id, username, password_hash) VALUES (?, ?, ?) ON CONFLICT(person_id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash');
            $statement->execute([$personId, $username, $hash]);
            $this->db->exec('COMMIT');
        } catch (\Throwable $error) {
            $this->db->exec('ROLLBACK');
            throw $error;
        }
        return ['personId' => $personId, 'username' => $username];
    }

    private function accountForPerson(string $personId): ?array
    {
        $statement = $this->db->prepare('SELECT username, password_hash FROM employee_accounts WHERE person_id = ?');
        $statement->execute([$personId]);
        return $statement->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public function directSwap(int $expectedRevision, string $day, string $personId, string $replacementId, bool $agreed, string $username): array
    {
        if (!$agreed) throw new \DomainException('Bitte die Absprache mit der Ersatzperson bestätigen.');
        $this->db->exec('BEGIN IMMEDIATE');
        try {
            $row = $this->stateRow();
            $this->requireRevision($row, $expectedRevision);
            $state = json_decode($row['data'], true, 512, JSON_THROW_ON_ERROR);
            $beforeA = $state['assignments'][$day][$personId] ?? null;
            $beforeB = $state['assignments'][$day][$replacementId] ?? null;
            $state = $this->rules->swap($state, $day, $personId, $replacementId);
            $this->writeState((int)$row['revision'] + 1, $state);
            $statement = $this->db->prepare('INSERT INTO swap_requests (date, person_id, replacement_id, person_shift, replacement_shift, created_by, agreed, status, created_at, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)');
            $now = gmdate('c');
            $statement->execute([$day, $personId, $replacementId, $beforeA, $beforeB, $username, 'approved', $now, $username, $now]);
            $this->supersedeConflictingRequests($day, $personId, $replacementId);
            $this->db->exec('COMMIT');
        } catch (\Throwable $error) {
            $this->db->exec('ROLLBACK');
            throw $error;
        }
        return $this->snapshot();
    }

    public function setAssignment(int $expectedRevision, string $day, string $personId, ?string $shift): array
    {
        $this->db->exec('BEGIN IMMEDIATE');
        try {
            $row = $this->stateRow();
            $this->requireRevision($row, $expectedRevision);
            $state = json_decode($row['data'], true, 512, JSON_THROW_ON_ERROR);
            $state = $this->rules->setAssignment($state, $day, $personId, $shift);
            $this->writeState((int)$row['revision'] + 1, $state);
            $statement = $this->db->prepare("UPDATE swap_requests SET status = 'superseded' WHERE status = 'pending' AND date = ? AND (person_id = ? OR replacement_id = ?)");
            $statement->execute([$day, $personId, $personId]);
            $this->db->exec('COMMIT');
        } catch (\Throwable $error) {
            $this->db->exec('ROLLBACK');
            throw $error;
        }
        return $this->snapshot();
    }

    public function decide(int $id, bool $approve, string $username): array
    {
        $this->db->exec('BEGIN IMMEDIATE');
        try {
            $statement = $this->db->prepare('SELECT * FROM swap_requests WHERE id = ?');
            $statement->execute([$id]);
            $request = $statement->fetch(PDO::FETCH_ASSOC);
            if (!$request || $request['status'] !== 'pending') throw new \DomainException('Der Antrag ist nicht mehr offen.');
            if ($approve) {
                $row = $this->stateRow();
                $state = json_decode($row['data'], true, 512, JSON_THROW_ON_ERROR);
                $assignments = $state['assignments'][$request['date']] ?? null;
                if (!is_array($assignments)
                    || ($assignments[$request['person_id']] ?? null) !== $request['person_shift']
                    || ($assignments[$request['replacement_id']] ?? null) !== $request['replacement_shift']) {
                    throw new \DomainException('Der Plan hat sich für diesen Tausch geändert. Bitte den Antrag neu stellen.');
                }
                $state = $this->rules->swap($state, $request['date'], $request['person_id'], $request['replacement_id']);
                $this->writeState((int)$row['revision'] + 1, $state);
                $this->supersedeConflictingRequests($request['date'], $request['person_id'], $request['replacement_id'], $id);
            }
            $statement = $this->db->prepare('UPDATE swap_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?');
            $statement->execute([$approve ? 'approved' : 'rejected', $username, gmdate('c'), $id]);
            $this->db->exec('COMMIT');
        } catch (\Throwable $error) {
            $this->db->exec('ROLLBACK');
            throw $error;
        }
        return $this->snapshot();
    }

    private function stateRow(): array
    {
        $row = $this->db->query('SELECT revision, data FROM plan_state WHERE id = 1')->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new \RuntimeException('Planungsdaten fehlen.');
        return $row;
    }

    private function writeState(int $revision, array $state): void
    {
        $statement = $this->db->prepare('UPDATE plan_state SET revision = ?, data = ? WHERE id = 1');
        $statement->execute([$revision, json_encode($state, JSON_THROW_ON_ERROR)]);
    }

    private function requireRevision(array $row, int $expected): void
    {
        if ((int)$row['revision'] !== $expected) throw new \DomainException('Der Plan wurde zwischenzeitlich geändert. Bitte neu laden.');
    }

    private function supersedeConflictingRequests(string $day, string $personId, string $replacementId, ?int $exceptId = null): void
    {
        $statement = $this->db->prepare("UPDATE swap_requests SET status = 'superseded' WHERE status = 'pending' AND date = ? AND id != ? AND (person_id IN (?, ?) OR replacement_id IN (?, ?))");
        $statement->execute([$day, $exceptId ?? -1, $personId, $replacementId, $personId, $replacementId]);
    }

    private function requests(): array
    {
        $rows = $this->db->query('SELECT * FROM swap_requests ORDER BY id DESC LIMIT 100')->fetchAll(PDO::FETCH_ASSOC);
        return array_map(static fn (array $row) => [
            'id' => (int)$row['id'], 'date' => $row['date'], 'personId' => $row['person_id'],
            'replacementId' => $row['replacement_id'], 'personShift' => $row['person_shift'],
            'replacementShift' => $row['replacement_shift'], 'createdBy' => $row['created_by'],
            'agreed' => (bool)$row['agreed'], 'status' => $row['status'], 'createdAt' => $row['created_at'],
            'decidedBy' => $row['decided_by'], 'decidedAt' => $row['decided_at'],
        ], $rows);
    }
}
