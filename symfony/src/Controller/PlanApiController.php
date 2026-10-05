<?php

declare(strict_types=1);

namespace App\Controller;

use App\Security\TeamUser;
use App\Service\PlanStore;
use App\Service\TenantRegistry;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Symfony\Component\Security\Core\Exception\AccessDeniedException;

final class PlanApiController extends AbstractController
{
    public function __construct(private readonly TenantRegistry $tenants) {}

    #[Route('/api/state', name: 'api_state', methods: ['GET'])]
    public function state(PlanStore $store): JsonResponse
    {
        return $this->json($this->tenantStore($store)->snapshot());
    }

    #[Route('/api/state', name: 'api_state_save', methods: ['PUT'])]
    #[IsGranted('ROLE_ADMIN')]
    public function save(Request $request, PlanStore $store): JsonResponse
    {
        $store = $this->tenantStore($store);
        return $this->mutate($request, function (array $input) use ($store): array {
            return $store->saveState($this->revision($input), $input);
        });
    }

    #[Route('/api/swap-requests', name: 'api_swap_request', methods: ['POST'])]
    public function requestSwap(Request $request, PlanStore $store): JsonResponse
    {
        $store = $this->tenantStore($store);
        return $this->mutate($request, function (array $input) use ($store): array {
            $personId = $this->field($input, 'personId');
            $user = $this->getUser();
            if (!$this->isGranted('ROLE_ADMIN') && (!$user instanceof TeamUser || $user->getPersonId() !== $personId)) {
                throw new AccessDeniedException('Du kannst nur für deine eigenen Dienste einen Tausch-Antrag stellen.');
            }
            return $store->requestSwap(
                $this->revision($input), $this->field($input, 'date'),
                $personId, $this->field($input, 'replacementId'),
                ($input['agreed'] ?? false) === true, $this->getUser()?->getUserIdentifier() ?? 'unknown'
            );
        });
    }

    #[Route('/api/accounts', name: 'api_accounts', methods: ['GET'])]
    #[IsGranted('ROLE_ADMIN')]
    public function accounts(PlanStore $store): JsonResponse
    {
        return $this->json(['accounts' => $this->tenantStore($store)->accounts()]);
    }

    #[Route('/api/accounts/{personId}', name: 'api_account_save', requirements: ['personId' => '[A-Za-z0-9_-]{1,80}'], methods: ['PUT'])]
    #[IsGranted('ROLE_ADMIN')]
    public function saveAccount(string $personId, Request $request, PlanStore $store): JsonResponse
    {
        $store = $this->tenantStore($store);
        return $this->mutate($request, function (array $input) use ($store, $personId): array {
            $username = $this->field($input, 'username');
            $password = $this->field($input, 'password', 200);
            return $store->saveAccount($personId, $username, $password);
        });
    }

    #[Route('/api/swaps', name: 'api_swap_direct', methods: ['POST'])]
    #[IsGranted('ROLE_ADMIN')]
    public function directSwap(Request $request, PlanStore $store): JsonResponse
    {
        $store = $this->tenantStore($store);
        return $this->mutate($request, function (array $input) use ($store): array {
            return $store->directSwap(
                $this->revision($input), $this->field($input, 'date'),
                $this->field($input, 'personId'), $this->field($input, 'replacementId'),
                ($input['agreed'] ?? false) === true, $this->getUser()?->getUserIdentifier() ?? 'unknown'
            );
        });
    }

    #[Route('/api/assignments', name: 'api_assignment_set', methods: ['POST'])]
    #[IsGranted('ROLE_ADMIN')]
    public function setAssignment(Request $request, PlanStore $store): JsonResponse
    {
        $store = $this->tenantStore($store);
        return $this->mutate($request, function (array $input) use ($store): array {
            $shift = $input['shift'] ?? null;
            if ($shift !== null && !is_string($shift)) throw new \DomainException('Ungültiger Dienst.');
            return $store->setAssignment(
                $this->revision($input), $this->field($input, 'date'),
                $this->field($input, 'personId'), $shift
            );
        });
    }

    #[Route('/api/swap-requests/{id}/approve', name: 'api_swap_approve', requirements: ['id' => '\\d+'], methods: ['POST'])]
    #[IsGranted('ROLE_ADMIN')]
    public function approve(int $id, Request $request, PlanStore $store): JsonResponse
    {
        $store = $this->tenantStore($store);
        return $this->mutate($request, fn (): array => $store->decide($id, true, $this->getUser()?->getUserIdentifier() ?? 'unknown'));
    }

    #[Route('/api/swap-requests/{id}/reject', name: 'api_swap_reject', requirements: ['id' => '\\d+'], methods: ['POST'])]
    #[IsGranted('ROLE_ADMIN')]
    public function reject(int $id, Request $request, PlanStore $store): JsonResponse
    {
        $store = $this->tenantStore($store);
        return $this->mutate($request, fn (): array => $store->decide($id, false, $this->getUser()?->getUserIdentifier() ?? 'unknown'));
    }

    private function mutate(Request $request, callable $callback): JsonResponse
    {
        $user = $this->getUser();
        if (!$user instanceof TeamUser || !$this->tenants->canWrite($user->getTenantSlug())) {
            return $this->json(['error' => 'Jahresabo nicht aktiv. Bitte die Freischaltung anfragen.'], 402);
        }
        if (!$this->isCsrfTokenValid('api', $request->headers->get('X-CSRF-TOKEN'))) {
            return $this->json(['error' => 'Sitzungsschutz ungültig. Bitte Seite neu laden.'], 403);
        }
        if (strlen($request->getContent()) > 2_000_000) return $this->json(['error' => 'Die Eingabe ist zu gross.'], 413);
        try {
            $input = $request->getContent() === '' ? [] : json_decode($request->getContent(), true, 512, JSON_THROW_ON_ERROR);
            if (!is_array($input)) throw new \DomainException('Ungültige Eingabe.');
            return $this->json($callback($input));
        } catch (AccessDeniedException $error) {
            return $this->json(['error' => $error->getMessage()], 403);
        } catch (\JsonException|\DomainException $error) {
            $status = str_contains($error->getMessage(), 'zwischenzeitlich') || str_contains($error->getMessage(), 'geändert') ? 409 : 422;
            return $this->json(['error' => $error->getMessage()], $status);
        }
    }

    private function tenantStore(PlanStore $store): PlanStore
    {
        $user = $this->getUser();
        if (!$user instanceof TeamUser) throw new AccessDeniedException();
        return $store->forTenant($user->getTenantSlug());
    }

    private function field(array $input, string $name, int $maxLength = 100): string
    {
        if (!isset($input[$name]) || !is_string($input[$name]) || strlen($input[$name]) > $maxLength) {
            throw new \DomainException('Bitte Datum und beide Personen angeben.');
        }
        return $input[$name];
    }

    private function revision(array $input): int
    {
        if (!isset($input['revision']) || !is_int($input['revision']) || $input['revision'] < 0) {
            throw new \DomainException('Planversion fehlt. Bitte neu laden.');
        }
        return $input['revision'];
    }
}
