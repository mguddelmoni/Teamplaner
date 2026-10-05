<?php

declare(strict_types=1);

namespace App\Controller;

use App\Security\ManagerUser;
use App\Service\PlanStore;
use App\Service\TenantRegistry;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Authentication\AuthenticationUtils;

final class ManagerController extends AbstractController
{
    #[Route('/manager/login', name: 'manager_login', methods: ['GET', 'POST'])]
    public function login(AuthenticationUtils $authenticationUtils): Response
    {
        if ($this->getUser() instanceof ManagerUser) return $this->redirectToRoute('manager_dashboard');
        return $this->render('manager/login.html.twig', [
            'last_username' => $authenticationUtils->getLastUsername(),
            'error' => $authenticationUtils->getLastAuthenticationError(),
        ]);
    }

    #[Route('/manager', name: 'manager_dashboard', methods: ['GET'])]
    public function dashboard(TenantRegistry $tenants): Response
    {
        $rows = [];
        foreach ($tenants->all() as $tenant) {
            $tenant['is_active'] = $tenants->canWrite($tenant['slug']);
            $rows[] = $tenant;
        }
        return $this->render('manager/dashboard.html.twig', ['tenants' => $rows]);
    }

    #[Route('/manager/tenants', name: 'manager_create_tenant', methods: ['POST'])]
    public function createTenant(Request $request, TenantRegistry $tenants, PlanStore $store): Response
    {
        if (!$this->isCsrfTokenValid('manager_create_tenant', $request->request->getString('_csrf_token'))) {
            throw $this->createAccessDeniedException('Ungültiger Sitzungsschutz.');
        }
        try {
            $tenant = $tenants->create(
                $request->request->getString('slug'), $request->request->getString('name'),
                $request->request->getString('email'), $request->request->getString('password')
            );
            $store->forTenant($tenant['slug']);
            $this->addFlash('success', 'Mandant '.$tenant['name'].' angelegt. Das Jahresabo wartet auf Freischaltung.');
        } catch (\DomainException $error) {
            $this->addFlash('error', $error->getMessage());
        }
        return $this->redirectToRoute('manager_dashboard');
    }

    #[Route('/manager/tenants/{slug}/activate', name: 'manager_activate_tenant', methods: ['POST'])]
    public function activate(Request $request, TenantRegistry $tenants, string $slug): Response
    {
        if (!$this->isCsrfTokenValid('manager_activate_'.$slug, $request->request->getString('_csrf_token'))) {
            throw $this->createAccessDeniedException('Ungültiger Sitzungsschutz.');
        }
        try {
            $tenant = $tenants->activateAnnual($slug, $request->request->getString('reference'));
            $this->addFlash('success', 'Jahresabo für '.$tenant['name'].' läuft bis '.(new \DateTimeImmutable($tenant['period_end']))->format('d.m.Y').'.');
        } catch (\DomainException $error) {
            $this->addFlash('error', $error->getMessage());
        }
        return $this->redirectToRoute('manager_dashboard');
    }

    #[Route('/manager/tenants/{slug}/admin-password', name: 'manager_reset_admin_password', methods: ['POST'])]
    public function resetAdminPassword(Request $request, TenantRegistry $tenants, string $slug): Response
    {
        if (!$this->isCsrfTokenValid('manager_reset_admin_'.$slug, $request->request->getString('_csrf_token'))) {
            throw $this->createAccessDeniedException('Ungültiger Sitzungsschutz.');
        }
        try {
            $tenants->resetAdminPassword($slug, $request->request->getString('password'));
            $this->addFlash('success', 'Admin-Passwort für '.$slug.' geändert. Anmeldung als admin unter /'.$slug.'.');
        } catch (\DomainException $error) {
            $this->addFlash('error', $error->getMessage());
        }
        return $this->redirectToRoute('manager_dashboard');
    }

    #[Route('/manager/logout', name: 'manager_logout', methods: ['POST'])]
    public function logout(): never
    {
        throw new \LogicException('Logout is handled by the Symfony firewall.');
    }
}
