<?php

declare(strict_types=1);

namespace App\Command;

use App\Service\TenantRegistry;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Helper\Table;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'teamplaner:tenants', description: 'Zeigt registrierte Organisationen und ihren Abo-Status.')]
final class ListTenantsCommand extends Command
{
    public function __construct(private readonly TenantRegistry $tenants) { parent::__construct(); }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $table = new Table($output);
        $table->setHeaders(['Kürzel', 'Organisation', 'Kontakt', 'Status', 'Läuft bis']);
        foreach ($this->tenants->all() as $tenant) {
            $table->addRow([
                $tenant['slug'], $tenant['name'], $tenant['billing_email'],
                $this->tenants->canWrite($tenant['slug']) ? 'aktiv' : 'ausstehend/abgelaufen',
                $tenant['period_end'] ?: '—',
            ]);
        }
        $table->render();
        return Command::SUCCESS;
    }
}
