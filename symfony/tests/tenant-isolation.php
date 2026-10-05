<?php

declare(strict_types=1);

use App\Kernel;
use App\Service\PlanRules;
use App\Service\PlanStore;
use App\Service\TenantRegistry;

require dirname(__DIR__).'/vendor/autoload.php';

$directory = sys_get_temp_dir().'/plandito-test-'.bin2hex(random_bytes(6));
mkdir($directory.'/tenants', 0700, true);
putenv('TEAMPLANER_PLATFORM_DB_PATH='.$directory.'/platform.sqlite');
putenv('TEAMPLANER_TENANTS_DIR='.$directory.'/tenants');
putenv('TEAMPLANER_DB_PATH='.$directory.'/legacy.sqlite');
$check = static function (bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
};

try {
    $kernel = new Kernel('test', true);
    $registry = new TenantRegistry($kernel);
    $rules = new PlanRules();
    $factory = new PlanStore($kernel, $rules, $registry);
    $registry->create('team-a', 'Team A', 'a@example.test', 'SecretPasswordA123');
    $registry->create('team-b', 'Team B', 'b@example.test', 'SecretPasswordB123');
    $registry->resetAdminPassword('team-b', 'NewAdminPassword123');
    $check(password_verify('NewAdminPassword123', $registry->adminPasswordHash('team-b')), 'Admin-Passwort lässt sich nicht durch Manager zurücksetzen.');
    $check(!password_verify('SecretPasswordB123', $registry->adminPasswordHash('team-b')), 'Altes Admin-Passwort blieb nach dem Zurücksetzen gültig.');
    $registry->createManager('manager', 'ManagerTestPassword123456789');
    $check(password_verify('ManagerTestPassword123456789', $registry->managerPasswordHash('manager')), 'Manager-Passwort wurde nicht getrennt gespeichert.');
    $check($registry->managerPasswordHash('team-a/admin') === null, 'Mandanten-Admin wurde als Manager akzeptiert.');
    $a = $factory->forTenant('team-a');
    $b = $factory->forTenant('team-b');
    $check($a->snapshot()['people'] === [] && $b->snapshot()['people'] === [], 'Neue Mandanten sind nicht leer.');
    $person = [
        'id' => 'person-1', 'name' => 'Test Person', 'percent' => 60,
        'vacationWeeks' => 5, 'weeklyOff' => [], 'offDates' => [],
        'vacationRanges' => [], 'avoid' => [],
    ];
    $state = $a->snapshot();
    $customStaffing = ['defaultTarget' => 5.5, 'defaultKey' => ['F', 'F', 'T', 'T', 'S', 'KF'], 'week' => [0 => ['target' => 0, 'key' => []]], 'overrides' => [
        $state['month'].'-15' => ['target' => 4, 'key' => ['F', 'T', 'T', 'S']],
    ]];
    $customWorkModel = ['weeklyHours' => 40, 'workdays' => [1, 2, 3, 4, 5], 'holidays' => ['2026-12-25']];
    $saved = $a->saveState($state['revision'], [
        'month' => $state['month'], 'people' => [$person],
        'shiftTypes' => $state['shiftTypes'], 'staffing' => $customStaffing, 'workModel' => $customWorkModel, 'assignments' => null,
    ]);
    $a->saveAccount('person-1', 'worker', 'WorkerPassword123');
    $check(count($saved['people']) === 1 && $b->snapshot()['people'] === [], 'Plan wurde mandantenübergreifend sichtbar.');
    $check($saved['staffing'] === $customStaffing && $b->snapshot()['staffing']['defaultTarget'] === 5, 'Tagesvorgaben wurden mandantenübergreifend sichtbar.');
    $check($saved['workModel'] === $customWorkModel && $b->snapshot()['workModel']['weeklyHours'] === 42, 'Arbeitszeitmodell ist nicht isoliert.');
    $optionalKey = $rules->validateState([...$saved, 'staffing' => [
        'defaultTarget' => 5, 'defaultKey' => ['F', 'F', 'T', 'T', 'S'],
        'overrides' => [$state['month'].'-15' => ['target' => 4]],
    ]]);
    $check($optionalKey['staffing']['overrides'][$state['month'].'-15']['key'] === [], 'Ein Tagespensum ohne Dienstschlüssel wurde nicht akzeptiert.');
    try {
        $rules->validateState([...$saved, 'staffing' => ['defaultTarget' => 4, 'defaultKey' => ['F', 'F', 'T', 'T', 'S'], 'overrides' => []]]);
        throw new RuntimeException('Ein Tagespensum unterhalb des Dienstschlüssels wurde akzeptiert.');
    } catch (DomainException) {
        // Die Vorgabe darf nicht kleiner als die Summe des Schlüssels sein.
    }
    $check($a->accountByUsername('worker') !== null && $b->accountByUsername('worker') === null, 'Konto wurde mandantenübergreifend sichtbar.');
    $check(!$registry->canWrite('team-a'), 'Neuer Mandant war vor Jahresfreischaltung beschreibbar.');
    $first = $registry->activateAnnual('team-a', 'TEST-INV-1');
    $second = $registry->activateAnnual('team-a', 'TEST-INV-1');
    $check($registry->canWrite('team-a') && $first['period_end'] === $second['period_end'], 'Jahresfreischaltung ist nicht idempotent.');
    $renewed = $registry->activateAnnual('team-a', 'TEST-INV-2');
    $check($renewed['period_start'] === $first['period_start'] && $renewed['period_end'] > $first['period_end'], 'Vorzeitige Verlängerung zeigt keine zusammenhängende Laufzeit.');
    $listed = $registry->all();
    $check(count($listed) === 2 && array_key_exists('period_start', $listed[0]) && array_key_exists('period_end', $listed[0]), 'Die Manager-Liste enthält nicht alle Laufzeitdaten.');
    $check(!$registry->canWrite('team-b'), 'Nicht freigeschalteter Mandant wurde beschreibbar.');

    $start = new DateTimeImmutable($saved['month'].'-01', new DateTimeZone('UTC'));
    $end = $start->modify('+1 month');
    $days = [];
    for ($day = $start; $day < $end; $day = $day->modify('+1 day')) $days[$day->format('Y-m-d')] = [];
    $saved = $a->saveState($saved['revision'], [
        'month' => $saved['month'], 'people' => [$person],
        'shiftTypes' => $saved['shiftTypes'], 'assignments' => $days,
    ]);
    $check($saved['staffing'] === $customStaffing, 'Eine ältere Speicheranfrage hat die Tagesvorgaben zurückgesetzt.');
    $check($saved['workModel'] === $customWorkModel, 'Eine ältere Anfrage hat das Arbeitszeitmodell zurückgesetzt.');
    $firstDay = array_key_first($days);
    $saved = $a->setAssignment($saved['revision'], $firstDay, 'person-1', 'KF');
    $check($saved['assignments'][$firstDay]['person-1'] === 'KF', 'Zusätzlicher Kurz-Dienst wurde nicht gespeichert.');
    $check($b->snapshot()['assignments'] === null, 'Kurz-Dienst wurde mandantenübergreifend sichtbar.');
    $flexibleTypes = $saved['shiftTypes'];
    foreach ($flexibleTypes as &$type) {
        if ($type['code'] === 'F') $type['minutes'] = 480;
        if ($type['code'] === 'KF') { $type['coverage'] = 'F'; $type['weight'] = 0.5; }
    }
    unset($type);
    $flexible = $rules->validateState([...$saved, 'shiftTypes' => $flexibleTypes]);
    $check($flexible['shiftTypes'][0]['minutes'] === 480, 'Bestehende Grunddienste sind weiterhin gesperrt.');
    $weekendAssignments = $days;
    foreach ($weekendAssignments as $day => &$daily) {
        if ((new DateTimeImmutable($day))->format('w') === '6') $daily['person-1'] = 'F';
    }
    unset($daily);
    $weekendState = $rules->validateState([...$saved, 'assignments' => $weekendAssignments]);
    $check(count($weekendState['assignments']) === count($days), 'Ein Plan mit zu wenigen freien Wochenenden wurde abgelehnt.');
    $updated = $rules->setAssignment($weekendState, $firstDay, 'person-1', 'T');
    $check($updated['assignments'][$firstDay]['person-1'] === 'T', 'Eine Zuweisung trotz zu wenigen freien Wochenenden wurde abgelehnt.');
    $replacement = [...$person, 'id' => 'person-2', 'name' => 'Ersatz'];
    $swapAssignments = $weekendAssignments;
    $swapAssignments[$firstDay]['person-2'] = 'T';
    $swapped = $rules->swap([...$weekendState, 'people' => [$person, $replacement], 'assignments' => $swapAssignments], $firstDay, 'person-2', 'person-1');
    $check(($swapped['assignments'][$firstDay]['person-1'] ?? null) === 'T', 'Ein Tausch trotz zu wenigen freien Wochenenden wurde abgelehnt.');
    $reloaded = $factory->forTenant('team-a')->snapshot();
    $check($reloaded['workModel'] === $customWorkModel && $reloaded['staffing'] === $customStaffing, 'Neue Einstellungen fehlen nach Öffnen einer neuen Datenbankverbindung.');
    $check($reloaded['assignments'][$firstDay]['person-1'] === 'KF', 'Gespeicherte Dienste gingen beim Neuladen verloren.');
    $check($b->snapshot()['workModel'] === $rules->defaultWorkModel() && $b->snapshot()['staffing']['week'] === [], 'Neue Einstellungen sind zum anderen Mandanten durchgesickert.');
    echo "OK: Mandantenisolierung, Tagesvorgaben, Jahresfreischaltung und Kurz-Dienst\n";
} finally {
    foreach (glob($directory.'/tenants/*') ?: [] as $file) unlink($file);
    foreach (glob($directory.'/*') ?: [] as $file) if (is_file($file)) unlink($file);
    rmdir($directory.'/tenants');
    rmdir($directory);
}
