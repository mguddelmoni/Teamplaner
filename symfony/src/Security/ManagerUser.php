<?php

declare(strict_types=1);

namespace App\Security;

use Symfony\Component\Security\Core\User\PasswordAuthenticatedUserInterface;
use Symfony\Component\Security\Core\User\UserInterface;

final class ManagerUser implements UserInterface, PasswordAuthenticatedUserInterface
{
    public function __construct(private readonly string $username, private readonly string $passwordHash) {}

    public function getUserIdentifier(): string { return $this->username; }
    public function getPassword(): string { return $this->passwordHash; }
    public function getRoles(): array { return ['ROLE_MANAGER']; }
    public function eraseCredentials(): void {}
}
