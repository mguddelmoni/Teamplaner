<?php

declare(strict_types=1);

namespace App\Security;

use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Component\Security\Http\Event\LogoutEvent;

#[AsEventListener(event: LogoutEvent::class, priority: 128)]
final class TenantLogoutRedirect
{
    public function __construct(private readonly UrlGeneratorInterface $urls) {}

    public function __invoke(LogoutEvent $event): void
    {
        $user = $event->getToken()?->getUser();
        if (!$user instanceof TeamUser || $user->getTenantSlug() === 'legacy') return;
        $event->setResponse(new RedirectResponse($this->urls->generate('tenant_login', ['slug' => $user->getTenantSlug()])));
    }
}
