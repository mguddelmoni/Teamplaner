<?php

declare(strict_types=1);

namespace App\Service;

final class PlanRules
{
    private const DEFAULT_SHIFT_TYPES = [
        ['code' => 'F', 'name' => 'Frühdienst', 'minutes' => 504, 'coverage' => 'F', 'weight' => 1, 'staffingUnits' => 1],
        ['code' => 'T', 'name' => 'Tagdienst', 'minutes' => 504, 'coverage' => 'T', 'weight' => 1, 'staffingUnits' => 1],
        ['code' => 'S', 'name' => 'Spätdienst', 'minutes' => 504, 'coverage' => 'S', 'weight' => 1, 'staffingUnits' => 1],
        ['code' => 'KF', 'name' => 'Kurz Früh', 'minutes' => 240, 'coverage' => null, 'weight' => 0, 'staffingUnits' => 0.5],
        ['code' => 'KS', 'name' => 'Kurz Spät', 'minutes' => 240, 'coverage' => null, 'weight' => 0, 'staffingUnits' => 0.5],
        ['code' => 'TFS', 'name' => 'Teilter Spätdienst', 'minutes' => 255, 'coverage' => null, 'weight' => 0, 'staffingUnits' => 0.5],
    ];

    public function defaultShiftTypes(): array { return self::DEFAULT_SHIFT_TYPES; }

    public function defaultWorkModel(): array
    {
        return ['weeklyHours' => 42, 'workdays' => [1, 2, 3, 4, 5], 'holidays' => []];
    }

    public function defaultStaffing(): array
    {
        return ['defaultTarget' => 5, 'defaultKey' => ['F', 'F', 'T', 'T', 'S'], 'week' => [], 'overrides' => []];
    }

    public function emptyState(): array
    {
        return ['month' => gmdate('Y-m'), 'people' => [], 'shiftTypes' => self::DEFAULT_SHIFT_TYPES, 'staffing' => $this->defaultStaffing(), 'workModel' => $this->defaultWorkModel(), 'assignments' => null];
    }

    private const DEFAULTS = [
        ['Emma Schmid', 100], ['Felix Weber', 100], ['Anna Meier', 40], ['Ben Keller', 40],
        ['Clara Roth', 40], ['David Fischer', 40], ['Eva Baumann', 60], ['Farid Huber', 60],
        ['Gina Müller', 60], ['Hugo Steiner', 60], ['Ida Graf', 60], ['Jonas Frei', 60],
    ];

    public function initialState(): array
    {
        $people = [];
        foreach (self::DEFAULTS as $index => [$name, $percent]) {
            $people[] = [
                'id' => 'person-'.($index + 1), 'name' => $name, 'percent' => $percent,
                'vacationWeeks' => 5, 'weeklyOff' => [], 'offDates' => [],
                'vacationRanges' => [], 'avoid' => [],
            ];
        }

        return ['month' => '2026-10', 'people' => $people, 'shiftTypes' => self::DEFAULT_SHIFT_TYPES, 'staffing' => $this->defaultStaffing(), 'workModel' => $this->defaultWorkModel(), 'assignments' => null];
    }

    public function validateState(array $state): array
    {
        $month = $state['month'] ?? null;
        if (!is_string($month) || !preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $month)) {
            throw new \DomainException('Bitte einen gültigen Planungsmonat wählen.');
        }
        $this->monthStart($month);
        $shiftTypes = $this->validateShiftTypes($state['shiftTypes'] ?? self::DEFAULT_SHIFT_TYPES);
        $shiftCodes = array_column($shiftTypes, 'code');
        $staffing = $this->validateStaffing($state['staffing'] ?? $this->defaultStaffing(), $shiftTypes);
        $workModel = $this->validateWorkModel($state['workModel'] ?? $this->defaultWorkModel());
        $people = $state['people'] ?? null;
        if (!is_array($people) || !array_is_list($people) || count($people) > 100) {
            throw new \DomainException('Das Team muss als Liste mit höchstens 100 Personen vorliegen.');
        }
        $seen = [];
        foreach ($people as $person) {
            if (!is_array($person)) throw new \DomainException('Ungültige Personendaten.');
            $id = $person['id'] ?? null;
            $name = $person['name'] ?? null;
            $percent = $person['percent'] ?? null;
            if (!is_string($id) || !preg_match('/^[A-Za-z0-9_-]{1,80}$/', $id) || isset($seen[$id])) {
                throw new \DomainException('Personen benötigen eindeutige Kennungen.');
            }
            $seen[$id] = true;
            if (!is_string($name) || trim($name) === '' || mb_strlen($name) > 80 || !is_int($percent) || $percent < 10 || $percent > 100) {
                throw new \DomainException('Name oder Pensum ist ungültig.');
            }
            if (isset($person['weeklyHours']) && !$this->validWeeklyHours($person['weeklyHours'])) {
                throw new \DomainException('Individuelle Wochenstunden: 0,25 bis 80 in Viertelstunden.');
            }
            $weeks = $person['vacationWeeks'] ?? null;
            if (!is_numeric($weeks) || $weeks < 0 || $weeks > 12 || fmod((float)$weeks * 2, 1.0) !== 0.0) {
                throw new \DomainException('Ferienwochen müssen zwischen 0 und 12 in halben Wochen liegen.');
            }
            foreach (['weeklyOff', 'offDates', 'vacationRanges', 'avoid'] as $field) {
                if (!isset($person[$field]) || !is_array($person[$field]) || !array_is_list($person[$field])) {
                    throw new \DomainException('Freiwünsche oder Ferien sind ungültig.');
                }
            }
            foreach ($person['weeklyOff'] as $day) if (!is_int($day) || $day < 0 || $day > 6) throw new \DomainException('Wochentag ist ungültig.');
            foreach ($person['offDates'] as $day) if (!$this->validDate($day)) throw new \DomainException('Datumswunsch ist ungültig.');
            foreach ($person['vacationRanges'] as $range) {
                if (!is_array($range) || !$this->validDate($range['start'] ?? null) || !$this->validDate($range['end'] ?? null) || $range['start'] > $range['end']) {
                    throw new \DomainException('Ferienzeitraum ist ungültig.');
                }
            }
            foreach ($person['avoid'] as $shift) if (!in_array($shift, $shiftCodes, true)) throw new \DomainException('Dienstpräferenz ist ungültig.');
        }
        $assignments = $state['assignments'] ?? null;
        if ($assignments !== null) {
            if (!is_array($assignments)) throw new \DomainException('Die Dienstzuweisungen sind ungültig.');
            $this->validateAssignments($month, $people, $assignments, $shiftTypes);
        }

        return ['month' => $month, 'people' => $people, 'shiftTypes' => $shiftTypes, 'staffing' => $staffing, 'workModel' => $workModel, 'assignments' => $assignments];
    }

    public function swap(array $state, string $day, string $personId, string $replacementId): array
    {
        $assignments = $state['assignments'] ?? null;
        if (!is_array($assignments) || !isset($assignments[$day]) || $personId === $replacementId) {
            throw new \DomainException('Für dieses Datum ist kein gültiger Tausch möglich.');
        }
        $ids = array_column($state['people'], 'id');
        if (!in_array($personId, $ids, true) || !in_array($replacementId, $ids, true)) {
            throw new \DomainException('Beide Personen müssen im Team sein.');
        }
        $beforeA = $assignments[$day][$personId] ?? null;
        $beforeB = $assignments[$day][$replacementId] ?? null;
        if ($beforeA === $beforeB) throw new \DomainException('Die beiden Personen haben bereits denselben Dienststatus.');
        if ($beforeB === null) unset($assignments[$day][$personId]);
        else $assignments[$day][$personId] = $beforeB;
        if ($beforeA === null) unset($assignments[$day][$replacementId]);
        else $assignments[$day][$replacementId] = $beforeA;
        $this->validateAssignments($state['month'], $state['people'], $assignments, $state['shiftTypes'] ?? self::DEFAULT_SHIFT_TYPES);
        $state['assignments'] = $assignments;
        return $state;
    }

    public function setAssignment(array $state, string $day, string $personId, ?string $shift): array
    {
        $assignments = $state['assignments'] ?? null;
        if (!is_array($assignments) || !array_key_exists($day, $assignments)) {
            throw new \DomainException('Für diesen Tag ist noch kein Plan gespeichert.');
        }
        if (!in_array($personId, array_column($state['people'], 'id'), true)) {
            throw new \DomainException('Die Person ist nicht im Team.');
        }
        if ($shift !== null && !in_array($shift, array_column($state['shiftTypes'] ?? self::DEFAULT_SHIFT_TYPES, 'code'), true)) {
            throw new \DomainException('Ungültiger Dienst.');
        }
        if ($shift === null) unset($assignments[$day][$personId]);
        else $assignments[$day][$personId] = $shift;
        $this->validateAssignments($state['month'], $state['people'], $assignments, $state['shiftTypes'] ?? self::DEFAULT_SHIFT_TYPES);
        $state['assignments'] = $assignments;
        return $state;
    }

    public function validateAssignments(string $month, array $people, array $assignments, ?array $shiftTypes = null): void
    {
        $this->monthStart($month);
        $shiftTypes ??= self::DEFAULT_SHIFT_TYPES;
        $shiftByCode = array_column($shiftTypes, null, 'code');
        if (count($assignments) > 3660) throw new \DomainException('Es können höchstens zehn Jahre Dienstplan gespeichert werden.');
        $personById = [];
        foreach ($people as $person) $personById[$person['id']] = $person;
        $months = [];
        foreach ($assignments as $key => $daily) {
            if (!$this->validDate($key) || !is_array($daily) || count($daily) > count($people)) {
                throw new \DomainException("Am $key sind die Dienstzuweisungen ungültig.");
            }
            $months[substr($key, 0, 7)] = true;
            foreach ($daily as $id => $shift) {
                if (!isset($personById[$id]) || !is_string($shift) || !isset($shiftByCode[$shift])) throw new \DomainException("Am $key ist eine Dienstzuweisung ungültig.");
                if ($this->onVacation($personById[$id], $key)) throw new \DomainException("Am $key liegt ein Dienst in den Ferien.");
                $type = $shiftByCode[$shift];
                if (isset($type['startTime'], $type['endTime'])) {
                    $nextDay = (new \DateTimeImmutable($key))->modify('+1 day')->format('Y-m-d');
                    $overnight = $type['endTime'] <= $type['startTime'];
                    if ($overnight && $type['endTime'] !== '00:00' && $this->onVacation($personById[$id], $nextDay)) {
                        throw new \DomainException("Der Dienst am $key reicht in die Ferien hinein.");
                    }
                    $nextType = $shiftByCode[$assignments[$nextDay][$id] ?? ''] ?? null;
                    if ($overnight && isset($nextType['startTime']) && $type['endTime'] > $nextType['startTime']) {
                        throw new \DomainException("Die Dienste am $key und $nextDay überschneiden sich.");
                    }
                }
            }
        }
        foreach (array_keys($months) as $plannedMonth) {
            $start = $this->monthStart($plannedMonth);
            $end = $start->modify('+1 month');
            for ($day = $start; $day < $end; $day = $day->modify('+1 day')) {
                if (!array_key_exists($day->format('Y-m-d'), $assignments)) {
                    throw new \DomainException("Der Monat $plannedMonth muss vollständig als Kalendermonat gespeichert sein.");
                }
            }
        }
    }

    private function validateShiftTypes(mixed $types): array
    {
        if (!is_array($types) || !array_is_list($types) || count($types) < 1 || count($types) > 30) {
            throw new \DomainException('Bitte 1 bis 30 gültige Diensttypen angeben.');
        }
        $seen = [];
        foreach ($types as &$type) {
            if (!is_array($type)) throw new \DomainException('Ungültiger Diensttyp.');
            $code = $type['code'] ?? null;
            $name = $type['name'] ?? null;
            $minutes = $type['minutes'] ?? null;
            $coverage = $type['coverage'] ?? null;
            $weight = $type['weight'] ?? null;
            $staffingUnits = $type['staffingUnits'] ?? (in_array($code, ['F', 'T', 'S'], true) ? 1 : 0.5);
            if (!is_string($code) || !preg_match('/^[A-Z][A-Z0-9]{0,5}$/', $code) || isset($seen[$code])
                || !is_string($name) || trim($name) === '' || mb_strlen($name) > 50
                || !is_int($minutes) || $minutes < 15 || $minutes > 1440
                || ($coverage !== null && (!is_string($coverage) || !preg_match('/^[A-Z][A-Z0-9]{0,5}$/', $coverage)))
                || !in_array($weight, [0, 0.5, 1], true)
                || !in_array($staffingUnits, [0, 0.5, 1], true)
                || (($coverage === null) !== ($weight === 0))) {
                throw new \DomainException('Diensttypen benötigen eindeutige Kürzel, eine Dauer und eine gültige Besetzungswirkung.');
            }
            $type['staffingUnits'] = $staffingUnits;
            $type['coverage'] = $coverage;
            $type['weight'] = $weight;
            $start = $type['startTime'] ?? null;
            $end = $type['endTime'] ?? null;
            $pause = $type['breakMinutes'] ?? 0;
            if (!is_int($pause) || $pause < 0 || $pause >= 1440) throw new \DomainException('Ungültige Pausendauer.');
            if ($start !== null || $end !== null) {
                if (!is_string($start) || !is_string($end) || !preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9]$/', $start) || !preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9]$/', $end)) {
                    throw new \DomainException('Bitte Beginn und Ende als gültige Uhrzeiten angeben.');
                }
                $clockMinutes = static fn (string $time): int => (int)substr($time, 0, 2) * 60 + (int)substr($time, 3, 2);
                $duration = ($clockMinutes($end) - $clockMinutes($start) + 1440) % 1440;
                if ($duration === 0) $duration = 1440;
                if ($duration - $pause !== $minutes) throw new \DomainException('Die Arbeitsdauer muss Beginn bis Ende abzüglich Pause entsprechen.');
            } elseif ($pause !== 0) {
                throw new \DomainException('Pausen benötigen Beginn und Ende.');
            }
            if (isset($type['color']) && (!is_string($type['color']) || !preg_match('/^#[0-9a-fA-F]{6}$/', $type['color']))) throw new \DomainException('Ungültige Dienstfarbe.');
            $seen[$code] = true;
        }
        unset($type);
        foreach ($types as $type) {
            if ($type['coverage'] !== null && !isset($seen[$type['coverage']])) throw new \DomainException('Der ersetzte Diensttyp existiert nicht.');
        }
        return $types;
    }

    private function validWeeklyHours(mixed $hours): bool
    {
        return (is_int($hours) || is_float($hours)) && $hours >= 0.25 && $hours <= 80 && fmod($hours * 4, 1.0) === 0.0;
    }

    private function validateWorkModel(mixed $model): array
    {
        if (!is_array($model) || !$this->validWeeklyHours($model['weeklyHours'] ?? null)) throw new \DomainException('Vollpensum: 0,25 bis 80 Wochenstunden in Viertelstunden.');
        $days = $model['workdays'] ?? null;
        if (!is_array($days) || !array_is_list($days) || count($days) < 1 || count($days) > 7 || count(array_unique($days, SORT_REGULAR)) !== count($days)) throw new \DomainException('Bitte eindeutige Arbeitstage für die Sollzeit wählen.');
        foreach ($days as $day) if (!is_int($day) || $day < 0 || $day > 6) throw new \DomainException('Ungültiger Arbeitstag.');
        $holidays = $model['holidays'] ?? [];
        if (!is_array($holidays) || !array_is_list($holidays) || count($holidays) > 3660) throw new \DomainException('Ungültige Feiertagsliste.');
        foreach ($holidays as $day) if (!$this->validDate($day)) throw new \DomainException('Ungültiges Feiertagsdatum.');
        return ['weeklyHours' => $model['weeklyHours'], 'workdays' => $days, 'holidays' => array_values(array_unique($holidays))];
    }

    private function validateStaffing(mixed $staffing, array $shiftTypes): array
    {
        if (!is_array($staffing) || !isset($staffing['defaultTarget'], $staffing['defaultKey'], $staffing['overrides'])
            || !is_array($staffing['overrides']) || count($staffing['overrides']) > 3660) {
            throw new \DomainException('Die Besetzungseinstellungen sind ungültig.');
        }
        $byCode = array_column($shiftTypes, null, 'code');
        $this->validateDailyRequirement($staffing['defaultTarget'], $staffing['defaultKey'], $byCode);
        $week = $staffing['week'] ?? [];
        if (!is_array($week) || count($week) > 7) throw new \DomainException('Ungültiges Wochenmuster.');
        foreach ($week as $weekday => &$requirement) {
            if (!preg_match('/^[0-6]$/', (string)$weekday) || !is_array($requirement)) throw new \DomainException('Ungültiger Wochentag im Wochenmuster.');
            $this->validateDailyRequirement($requirement['target'] ?? null, $requirement['key'] ?? [], $byCode);
            $requirement = ['target' => $requirement['target'], 'key' => $requirement['key'] ?? []];
        }
        unset($requirement);
        $overrides = [];
        foreach ($staffing['overrides'] as $day => $requirement) {
            if (!$this->validDate($day) || !is_array($requirement)) throw new \DomainException('Eine Tagesbesetzung ist ungültig.');
            $key = $requirement['key'] ?? [];
            $this->validateDailyRequirement($requirement['target'] ?? null, $key, $byCode);
            $overrides[$day] = ['target' => $requirement['target'], 'key' => $key];
        }
        return [
            'defaultTarget' => $staffing['defaultTarget'],
            'defaultKey' => $staffing['defaultKey'],
            'week' => $week,
            'overrides' => $overrides,
        ];
    }

    private function validateDailyRequirement(mixed $target, mixed $key, array $byCode): void
    {
        if ((!is_int($target) && !is_float($target)) || $target < 0 || $target > 30 || fmod((float)$target * 2, 1.0) !== 0.0
            || !is_array($key) || !array_is_list($key) || count($key) > 30) {
            throw new \DomainException('Tagespensum: 0 bis 30 in halben Schritten; Dienstschlüssel: höchstens 30 Dienste.');
        }
        foreach ($key as $code) {
            if (!is_string($code) || !isset($byCode[$code])) throw new \DomainException('Der Dienstschlüssel enthält einen unbekannten Dienst.');
        }
        $keyUnits = array_reduce($key, static fn (float $sum, string $code): float => $sum + $byCode[$code]['staffingUnits'], 0.0);
        if ($keyUnits > $target) throw new \DomainException('Das Tagespensum muss mindestens so hoch wie der Dienstschlüssel sein.');
    }

    private function monthStart(string $month): \DateTimeImmutable
    {
        $date = \DateTimeImmutable::createFromFormat('!Y-m', $month, new \DateTimeZone('UTC'));
        if ($date === false || $date->format('Y-m') !== $month) throw new \DomainException('Ungültiger Monat.');
        return $date;
    }

    private function validDate(mixed $value): bool
    {
        if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) return false;
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $value, new \DateTimeZone('UTC'));
        return $date !== false && $date->format('Y-m-d') === $value;
    }

    private function onVacation(array $person, string $date): bool
    {
        foreach ($person['vacationRanges'] as $range) if ($date >= $range['start'] && $date <= $range['end']) return true;
        return false;
    }
}
