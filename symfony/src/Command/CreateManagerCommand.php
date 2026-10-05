<?php

declare(strict_types=1);

namespace App\Command;

use App\Service\TenantRegistry;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\HttpKernel\KernelInterface;

#[AsCommand(name: 'teamplaner:manager:create', description: 'Erstellt einen getrennten Betreiberzugang mit zufälligem Passwort.')]
final class CreateManagerCommand extends Command
{
    public function __construct(private readonly TenantRegistry $tenants, private readonly KernelInterface $kernel) { parent::__construct(); }

    protected function configure(): void
    {
        $this->addArgument('username', InputArgument::OPTIONAL, 'Manager-Name', 'manager');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $username = (string)$input->getArgument('username');
        $password = bin2hex(random_bytes(20));
        $path = $this->kernel->getProjectDir().'/var/manager-first-login.txt';
        if (file_exists($path)) {
            $output->writeln('<error>Bitte die vorhandene Datei var/manager-first-login.txt zuerst sicher entfernen oder verwahren.</error>');
            return Command::FAILURE;
        }
        $previousMask = umask(0077);
        $handle = @fopen($path, 'x');
        umask($previousMask);
        if ($handle === false) {
            $output->writeln('<error>Zugangsdaten konnten nicht gespeichert werden.</error>');
            return Command::FAILURE;
        }
        try {
            $content = "Login: /manager/login\nBenutzername: {$username}\nPasswort: {$password}\n";
            if (fwrite($handle, $content) !== strlen($content)) throw new \RuntimeException('Zugangsdaten konnten nicht vollständig gespeichert werden.');
            fclose($handle);
            $handle = null;
            $this->tenants->createManager($username, $password);
        } catch (\DomainException|\RuntimeException $error) {
            if ($handle !== null) fclose($handle);
            unlink($path);
            $output->writeln('<error>'.$error->getMessage().'</error>');
            return Command::FAILURE;
        }
        $output->writeln('Managerzugang erstellt. Einmalige Zugangsdaten: var/manager-first-login.txt (Dateirechte 0600).');
        return Command::SUCCESS;
    }
}
