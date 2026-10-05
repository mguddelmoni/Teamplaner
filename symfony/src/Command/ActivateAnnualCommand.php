<?php

declare(strict_types=1);

namespace App\Command;

use App\Service\TenantRegistry;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

#[AsCommand(name: 'teamplaner:activate-annual', description: 'Schaltet ein Jahresabo nach manueller Zahlungsprüfung frei.')]
final class ActivateAnnualCommand extends Command
{
    public function __construct(private readonly TenantRegistry $tenants) { parent::__construct(); }

    protected function configure(): void
    {
        $this->addArgument('slug', InputArgument::REQUIRED, 'Organisationskürzel');
        $this->addArgument('reference', InputArgument::REQUIRED, 'Eindeutige Rechnungs- oder Zahlungsreferenz');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        try {
            $tenant = $this->tenants->activateAnnual((string)$input->getArgument('slug'), (string)$input->getArgument('reference'));
        } catch (\DomainException $error) {
            $output->writeln('<error>'.$error->getMessage().'</error>');
            return Command::FAILURE;
        }
        $output->writeln(sprintf('Jahresabo für %s aktiv bis %s.', $tenant['slug'], $tenant['period_end']));
        return Command::SUCCESS;
    }
}
