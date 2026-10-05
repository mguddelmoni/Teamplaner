<?php

declare(strict_types=1);

namespace App\Security;

use App\Service\PlanStore;
use App\Service\TenantRegistry;
use Symfony\Component\Security\Core\Exception\UnsupportedUserException;
use Symfony\Component\Security\Core\Exception\UserNotFoundException;
use Symfony\Component\Security\Core\User\InMemoryUser;
use Symfony\Component\Security\Core\User\UserInterface;
use Symfony\Component\Security\Core\User\UserProviderInterface;

/** @implements UserProviderInterface<TeamUser> */
final class TeamUserProvider implements UserProviderInterface
{
    public function __construct(
        private readonly PlanStore $store,
        private readonly TenantRegistry $tenants,
    ) {}

    public function loadUserByIdentifier(string $identifier): TeamUser
    {
        $parts = explode('/', $identifier);
        if (count($parts) === 1) {
            $slug = 'legacy';
            $username = $identifier;
        } elseif (count($parts) === 2 && $parts[0] !== 'legacy') {
            [$slug, $username] = $parts;
        } else {
            $this->notFound($identifier);
        }
        if ($slug === 'legacy' && ($_SERVER['LEGACY_TENANT_ENABLED'] ?? $_ENV['LEGACY_TENANT_ENABLED'] ?? getenv('LEGACY_TENANT_ENABLED')) !== '1') $this->notFound($identifier);
        if ($slug === 'legacy' && $username === 'admin') {
            $hash = $_SERVER['ADMIN_PASSWORD_HASH'] ?? $_ENV['ADMIN_PASSWORD_HASH'] ?? getenv('ADMIN_PASSWORD_HASH');
            if (!is_string($hash) || $hash === '') $this->notFound($identifier);
            return new TeamUser('admin', $hash, ['ROLE_ADMIN']);
        }
        if ($slug !== 'legacy') {
            $hash = $username === 'admin' ? $this->tenants->adminPasswordHash($slug) : null;
            if ($hash !== null) return new TeamUser($identifier, $hash, ['ROLE_ADMIN'], null, $slug);
            if ($this->tenants->find($slug) === null) $this->notFound($identifier);
        }
        $account = $this->store->forTenant($slug)->accountByUsername($username);
        if ($account !== null) {
            return new TeamUser($identifier, $account['password_hash'], ['ROLE_EMPLOYEE'], $account['person_id'], $slug);
        }
        $this->notFound($identifier);
    }

    private function notFound(string $identifier): never
    {
        $exception = new UserNotFoundException();
        $exception->setUserIdentifier($identifier);
        throw $exception;
    }

    public function refreshUser(UserInterface $user): TeamUser
    {
        // Bestehende Sitzungen aus der früheren In-Memory-Anmeldung sauber erneuern.
        if (!$user instanceof TeamUser && !$user instanceof InMemoryUser) throw new UnsupportedUserException();
        return $this->loadUserByIdentifier($user->getUserIdentifier());
    }

    public function supportsClass(string $class): bool
    {
        return $class === TeamUser::class || is_subclass_of($class, TeamUser::class) || $class === InMemoryUser::class;
    }
}
