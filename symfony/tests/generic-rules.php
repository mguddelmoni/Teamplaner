<?php

declare(strict_types=1);

use App\Service\PlanRules;

require dirname(__DIR__).'/vendor/autoload.php';
$rules = new PlanRules();
$check = static function (bool $value, string $message): void {
    if (!$value) throw new RuntimeException($message);
};
$reject = static function (array $state, string $message) use ($rules): void {
    try { $rules->validateState($state); }
    catch (DomainException) { return; }
    throw new RuntimeException($message);
};
$person = ['id' => 'p', 'name' => 'Test', 'percent' => 60, 'weeklyHours' => 20, 'vacationWeeks' => 5, 'weeklyOff' => [], 'offDates' => [], 'vacationRanges' => [], 'avoid' => []];
$type = ['code' => 'BUERO', 'name' => 'Büro', 'minutes' => 450, 'startTime' => '08:00', 'endTime' => '16:00', 'breakMinutes' => 30, 'coverage' => null, 'weight' => 0, 'staffingUnits' => 1, 'color' => '#dceafa'];
$state = [
    'month' => '2026-10', 'people' => [$person], 'shiftTypes' => [$type], 'assignments' => null,
    'workModel' => ['weeklyHours' => 37.5, 'workdays' => [1, 2, 3, 4, 5], 'holidays' => ['2026-12-25']],
    'staffing' => ['defaultTarget' => 1, 'defaultKey' => ['BUERO'], 'week' => [0 => ['target' => 0, 'key' => []]], 'overrides' => []],
];
$validated = $rules->validateState($state);
$check($validated == $state, 'Ein eigenes Arbeitszeitmodell mit einem freien Diensttyp wurde verändert.');
$legacy = $rules->initialState();
unset($legacy['workModel'], $legacy['staffing']['week']);
$legacy = $rules->validateState($legacy);
$check($legacy['workModel'] === $rules->defaultWorkModel() && $legacy['staffing']['week'] === [], 'Alte Pläne erhalten keine rückwärtskompatiblen Standards.');
foreach ([['weeklyHours' => 0], ['weeklyHours' => '40'], ['weeklyHours' => 40.1], ['workdays' => []], ['workdays' => [1, 1]], ['workdays' => [7]], ['holidays' => ['2026-02-30']]] as $change) {
    $reject([...$state, 'workModel' => [...$state['workModel'], ...$change]], 'Ungültiges Arbeitszeitmodell akzeptiert.');
}
$reject([...$state, 'people' => [[...$person, 'weeklyHours' => -1]]], 'Negative Vertragsstunden akzeptiert.');
foreach ([['minutes' => 480], ['startTime' => '25:00'], ['endTime' => null], ['breakMinutes' => -1], ['color' => 'red;display:none'], ['coverage' => 'F', 'weight' => 1]] as $change) {
    $reject([...$state, 'shiftTypes' => [[...$type, ...$change]]], 'Ungültiger Diensttyp akzeptiert.');
}
foreach ([[7 => ['target' => 0, 'key' => []]], [1 => ['target' => 0, 'key' => ['BUERO']]], [1 => ['target' => 1, 'key' => ['FEHLT']]]] as $week) {
    $reject([...$state, 'staffing' => [...$state['staffing'], 'week' => $week]], 'Ungültiges Wochenmuster akzeptiert.');
}
$days = [];
for ($i = 1; $i <= 31; $i++) $days[sprintf('2026-10-%02d', $i)] = [];
$days['2026-10-01']['p'] = 'BUERO';
$saved = $rules->validateState([...$state, 'assignments' => $days]);
$reject([...$saved, 'shiftTypes' => [[...$type, 'code' => 'ANDERS']], 'staffing' => ['defaultTarget' => 0, 'defaultKey' => [], 'overrides' => []]], 'Ein verwendeter Diensttyp konnte verschwinden.');
$night = [...$type, 'code' => 'N', 'name' => 'Nacht', 'minutes' => 480, 'startTime' => '22:00', 'endTime' => '06:00', 'breakMinutes' => 0];
$early = [...$type, 'code' => 'M', 'name' => 'Morgen', 'minutes' => 240, 'startTime' => '05:00', 'endTime' => '09:00', 'breakMinutes' => 0];
$days['2026-10-01']['p'] = 'N';
$days['2026-10-02']['p'] = 'M';
$nightState = [...$state, 'shiftTypes' => [$night, $early], 'staffing' => ['defaultTarget' => 0, 'defaultKey' => [], 'overrides' => []], 'assignments' => $days];
$reject($nightState, 'Überlappende Dienste akzeptiert.');
$nightState['assignments']['2026-10-02'] = [];
$check($rules->validateState($nightState)['assignments']['2026-10-01']['p'] === 'N', 'Gültiger Nachtdienst abgelehnt.');
$reject([...$nightState, 'people' => [[...$person, 'vacationRanges' => [['start' => '2026-10-02', 'end' => '2026-10-02']]]]], 'Nachtdienst reicht in Ferien hinein.');
$midnight = [...$night, 'endTime' => '00:00', 'minutes' => 120];
$endsAtMidnight = $rules->validateState([...$nightState, 'shiftTypes' => [$midnight, $early], 'people' => [[...$person, 'vacationRanges' => [['start' => '2026-10-02', 'end' => '2026-10-02']]]]]);
$check($endsAtMidnight['assignments']['2026-10-01']['p'] === 'N', 'Ein Dienst bis Mitternacht belegt den Folgetag.');
echo "OK: Arbeitszeitmodelle, Wochenmuster, freie Dienste, Bestandsdaten und Nachtgrenzen\n";
