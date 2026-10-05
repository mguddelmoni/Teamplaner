<?php

declare(strict_types=1);

namespace App\Security;

use App\Service\TenantRegistry;
use Symfony\Component\Security\Core\Exception\UnsupportedUserException;
use Symfony\Component\Security\Core\Exception\UserNotFoundException;
use Symfony\Component\Security\Core\User\UserInterface;
use Symfony\Component\Security\Core\User\UserProviderInterface;

/** @implements UserProviderInterface<ManagerUser> */
final class ManagerUserProvider implements UserProviderInterface
{
    public function __construct(private readonly TenantRegistry $tenants) {}

    public function loadUserByIdentifier(string $identifier): ManagerUser
    {
        $hash = $this->tenants->managerPasswordHash($identifier);
        if ($hash === null) {
            $error = new UserNotFoundException();
            $error->setUserIdentifier($identifier);
            throw $error;
        }
        return new ManagerUser($identifier, $hash);
    }

    public function refreshUser(UserInterface $user): ManagerUser
    {
        if (!$user instanceof ManagerUser) throw new UnsupportedUserException();
        return $this->loadUserByIdentifier($user->getUserIdentifier());
    }

    public function supportsClass(string $class): bool
    {
        return $class === ManagerUser::class || is_subclass_of($class, ManagerUser::class);
    }
}
