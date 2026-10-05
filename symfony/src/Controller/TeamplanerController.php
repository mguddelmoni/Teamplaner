<?php

declare(strict_types=1);

namespace App\Controller;

use App\Security\TeamUser;
use App\Service\TenantRegistry;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class TeamplanerController extends AbstractController
{
    #[Route('/', name: 'teamplaner', methods: ['GET'])]
    public function index(TenantRegistry $tenants): Response
    {
        $user = $this->getUser();
        $slug = $user instanceof TeamUser ? $user->getTenantSlug() : 'legacy';
        $tenant = $slug === 'legacy' ? null : $tenants->find($slug);
        return $this->render('teamplaner/index.html.twig', [
            'ownPersonId' => $user instanceof TeamUser ? $user->getPersonId() : null,
            'tenantName' => $tenant['name'] ?? 'Lokaler Plan',
            'tenantSlug' => $slug,
            'canWrite' => $tenants->canWrite($slug),
        ]);
    }
}
