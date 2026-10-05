<?php

declare(strict_types=1);

namespace App\Security;

use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Http\Authenticator\AbstractLoginFormAuthenticator;
use Symfony\Component\Security\Http\Authenticator\Passport\Badge\CsrfTokenBadge;
use Symfony\Component\Security\Http\Authenticator\Passport\Badge\UserBadge;
use Symfony\Component\Security\Http\Authenticator\Passport\Credentials\PasswordCredentials;
use Symfony\Component\Security\Http\Authenticator\Passport\Passport;
use Symfony\Component\Security\Http\SecurityRequestAttributes;

final class TenantLoginAuthenticator extends AbstractLoginFormAuthenticator
{
    public function __construct(private readonly UrlGeneratorInterface $urls) {}

    public function supports(Request $request): bool
    {
        return $request->isMethod('POST') && $request->attributes->get('_route') === 'tenant_login';
    }

    public function authenticate(Request $request): Passport
    {
        $slug = (string)$request->attributes->get('slug');
        $username = strtolower(trim($request->request->getString('_username')));
        $request->getSession()->set(SecurityRequestAttributes::LAST_USERNAME, $username);
        return new Passport(
            new UserBadge($slug.'/'.$username),
            new PasswordCredentials($request->request->getString('_password')),
            [new CsrfTokenBadge('authenticate_tenant_'.$slug, $request->request->getString('_csrf_token'))]
        );
    }

    public function onAuthenticationSuccess(Request $request, TokenInterface $token, string $firewallName): ?Response
    {
        return new RedirectResponse($this->urls->generate('teamplaner'));
    }

    protected function getLoginUrl(Request $request): string
    {
        $slug = $request->attributes->get('slug');
        return is_string($slug) && $slug !== '' ? $this->urls->generate('tenant_login', ['slug' => $slug]) : $this->urls->generate('login');
    }
}
