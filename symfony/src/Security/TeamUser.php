<?php

declare(strict_types=1);

namespace App\Security;

use Symfony\Component\Security\Core\User\PasswordAuthenticatedUserInterface;
use Symfony\Component\Security\Core\User\UserInterface;

final class TeamUser implements UserInterface, PasswordAuthenticatedUserInterface
{
    public function __construct(
        private readonly string $username,
        private readonly string $passwordHash,
        private readonly array $roles,
        private readonly ?string $personId = null,
        private readonly string $tenantSlug = 'legacy',
    ) {}

    public function getUserIdentifier(): string { return $this->username; }
    public function getPassword(): string { return $this->passwordHash; }
    public function getRoles(): array { return $this->roles; }
    public function getPersonId(): ?string { return $this->personId; }
    public function getTenantSlug(): string { return $this->tenantSlug; }
    #[\Deprecated(since: 'symfony/security-core 7.3')]
    public function eraseCredentials(): void {}
}
