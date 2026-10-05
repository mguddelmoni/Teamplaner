<?php

declare(strict_types=1);

namespace App\Command;

use App\Service\PlanStore;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\HttpKernel\KernelInterface;

#[AsCommand(name: 'teamplaner:bootstrap-logins', description: 'Erstellt fehlende persönliche Mitarbeiter-Logins.')]
final class BootstrapEmployeeLoginsCommand extends Command
{
    public function __construct(private readonly PlanStore $store, private readonly KernelInterface $kernel)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $store = $this->store->forTenant('legacy');
        $accounts = $store->accounts();
        $used = array_fill_keys(array_map(static fn (array $account) => $account['username'], $accounts), true);
        $existingIds = array_fill_keys(array_map(static fn (array $account) => $account['personId'], $accounts), true);
        $created = [];
        foreach ($store->snapshot()['people'] as $person) {
            if (isset($existingIds[$person['id']])) continue;
            $name = strtr(mb_strtolower($person['name']), ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss']);
            $slug = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $name) ?: $name;
            $base = trim(preg_replace('/[^a-z0-9]+/', '.', $slug), '.');
            if (strlen($base) < 3) $base = 'mitarbeiter';
            $base = substr($base, 0, 35);
            $username = $base;
            for ($index = 2; isset($used[$username]) || $username === 'admin'; $index++) {
                $username = $base.'.'.$index;
            }
            $password = bin2hex(random_bytes(12));
            $store->saveAccount($person['id'], $username, $password);
            $used[$username] = true;
            $created[] = $person['name']."\t".$username."\t".$password;
        }
        if ($created === []) {
            $output->writeln('Alle Mitarbeitenden haben bereits einen persönlichen Login.');
            return Command::SUCCESS;
        }
        $path = $this->kernel->getProjectDir().'/var/employee-logins.txt';
        $stream = fopen($path, 'ab');
        if ($stream === false) throw new \RuntimeException('Die Zugangsdaten-Datei konnte nicht erstellt werden.');
        try {
            chmod($path, 0600);
            if (!flock($stream, LOCK_EX)) throw new \RuntimeException('Die Zugangsdaten-Datei konnte nicht gesperrt werden.');
            fwrite($stream, implode("\n", $created)."\n");
            fflush($stream);
            flock($stream, LOCK_UN);
        } finally {
            fclose($stream);
        }
        $output->writeln(sprintf('%d persönliche Logins erstellt. Zugangsdaten: %s', count($created), $path));
        return Command::SUCCESS;
    }
}
