<?php

declare(strict_types=1);

namespace App\Controller;

use App\Security\TeamUser;
use App\Service\PlanStore;
use App\Service\TenantRegistry;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Authentication\AuthenticationUtils;

final class SecurityController extends AbstractController
{
    #[Route('/login', name: 'login', methods: ['GET', 'POST'])]
    public function login(Request $request, TenantRegistry $tenants, AuthenticationUtils $authenticationUtils): Response
    {
        $slug = $request->query->getString('created');
        if ($slug !== '' && $tenants->find($slug) !== null) {
            return $this->redirectToRoute('tenant_login', ['slug' => $slug]);
        }
        return $this->render('security/login.html.twig', [
            'last_username' => $authenticationUtils->getLastUsername(),
            'error' => $authenticationUtils->getLastAuthenticationError(),
        ]);
    }

    #[Route('/{slug}', name: 'tenant_login', requirements: ['slug' => '[a-z0-9][a-z0-9-]{2,39}'], priority: -100, methods: ['GET', 'POST'])]
    public function tenantLogin(string $slug, TenantRegistry $tenants, AuthenticationUtils $authenticationUtils): Response
    {
        $tenant = $tenants->find($slug);
        if ($tenant === null) throw $this->createNotFoundException('Organisation nicht gefunden.');
        return $this->render('security/tenant-login.html.twig', [
            'tenant' => $tenant,
            'last_username' => $authenticationUtils->getLastUsername(),
            'error' => $authenticationUtils->getLastAuthenticationError(),
        ]);
    }

    #[Route('/registrieren', name: 'register_tenant', methods: ['GET', 'POST'])]
    public function register(Request $request, TenantRegistry $tenants, PlanStore $store, RateLimiterFactoryInterface $registrationLimiter): Response
    {
        if ($this->getUser() !== null) return $this->redirectToRoute('teamplaner');
        $error = null;
        if ($request->isMethod('POST')) {
            if (!$registrationLimiter->create($request->getClientIp() ?: 'unknown')->consume(1)->isAccepted()) {
                $error = 'Zu viele Registrierungsversuche. Bitte später erneut versuchen.';
            } elseif (!$this->isCsrfTokenValid('register', $request->request->getString('_csrf_token'))) {
                $error = 'Sitzungsschutz ungültig. Bitte Seite neu laden.';
            } else {
                try {
                    $tenant = $tenants->create(
                        $request->request->getString('slug'), $request->request->getString('name'),
                        $request->request->getString('email'), $request->request->getString('password')
                    );
                    $store->forTenant($tenant['slug']);
                    return $this->redirectToRoute('tenant_login', ['slug' => $tenant['slug']]);
                } catch (\DomainException $exception) {
                    $error = $exception->getMessage();
                }
            }
        }
        return $this->render('security/register.html.twig', [
            'error' => $error,
            'name' => $request->request->getString('name'),
            'slug' => $request->request->getString('slug'),
            'email' => $request->request->getString('email'),
        ]);
    }

    #[Route('/abo', name: 'subscription', methods: ['GET'])]
    public function subscription(TenantRegistry $tenants): Response
    {
        $user = $this->getUser();
        if (!$user instanceof TeamUser) return $this->redirectToRoute('login');
        $slug = $user->getTenantSlug();
        return $this->render('teamplaner/subscription.html.twig', [
            'tenant' => $slug === 'legacy' ? ['slug' => 'legacy', 'name' => 'Bestehender Teamplan', 'billing_email' => null, 'status' => 'active', 'period_start' => null, 'period_end' => null] : $tenants->find($slug),
            'canWrite' => $tenants->canWrite($slug),
        ]);
    }

    #[Route('/abo/verlaengern', name: 'subscription_renew', methods: ['GET'])]
    #[Route('/abo/kuendigen', name: 'subscription_cancel', methods: ['GET'])]
    public function stripePlaceholder(Request $request): Response
    {
        if (!$this->getUser() instanceof TeamUser) return $this->redirectToRoute('login');
        return $this->render('teamplaner/stripe-placeholder.html.twig', [
            'renewal' => $request->attributes->get('_route') === 'subscription_renew',
        ]);
    }

    #[Route('/logout', name: 'logout', methods: ['POST'])]
    public function logout(): never
    {
        throw new \LogicException('Logout is handled by the Symfony firewall.');
    }
}
