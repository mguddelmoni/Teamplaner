import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STAFFING, dailyRequirement, planTwoMonths, staffingStatus, summarizeAssignments } from '../symfony/public/assets/solver.mjs';

const people = Array.from({ length: 12 }, (_, index) => ({
  id: `person-${index + 1}`, name: `Person ${index + 1}`,
  percent: index < 2 ? 100 : index < 6 ? 40 : 60,
  vacationWeeks: 5, weeklyOff: [], offDates: [], vacationRanges: [], avoid: [],
}));

test('rolling planning keeps January and accounts for its cross-month weekend', () => {
  const first = planTwoMonths('2025-12', people);
  assert.equal(first.error, undefined);
  const january = Object.fromEntries(Object.entries(first.assignments).filter(([day]) => day.startsWith('2026-01')));
  const rolling = planTwoMonths('2026-01', people, january);
  assert.equal(rolling.error, undefined);
  assert.equal(rolling.coverage, true);
  assert.deepEqual(Object.fromEntries(Object.entries(rolling.assignments).filter(([day]) => day.startsWith('2026-01'))), january);
  assert.ok(rolling.byPerson.every(row => row.freeWeekends.every(count => count >= 2)));
  assert.equal(Object.keys(rolling.assignments).filter(day => day.startsWith('2026-02')).length, 28);
});

test('a deleted duty stays absent and makes coverage incomplete', () => {
  const first = planTwoMonths('2026-10', people);
  assert.equal(first.error, undefined);
  const assignments = structuredClone(first.assignments);
  const personId = Object.keys(assignments['2026-10-15'])[0];
  delete assignments['2026-10-15'][personId];
  const summary = summarizeAssignments('2026-10', people, assignments);
  assert.equal(summary.coverage, false);
  assert.equal(summary.assignedDuties, summary.requiredDuties - 1);
  assert.equal(assignments['2026-10-15'][personId], undefined);
});

test('additional short duties count their own minutes without replacing base coverage', () => {
  const first = planTwoMonths('2026-10', people);
  assert.equal(first.error, undefined);
  const assignments = structuredClone(first.assignments);
  const day = '2026-10-15';
  const freePerson = people.find(person => !assignments[day][person.id]);
  const before = summarizeAssignments('2026-10', people, assignments);
  assignments[day][freePerson.id] = 'KF';
  const after = summarizeAssignments('2026-10', people, assignments);
  assert.equal(after.coverage, true);
  assert.equal(after.assignedDuties, before.assignedDuties);
  assert.equal(after.capacityHours - before.capacityHours, 4);
  assert.equal(after.byPerson.find(row => row.id === freePerson.id).actualHours - before.byPerson.find(row => row.id === freePerson.id).actualHours, 4);
  assignments[day][freePerson.id] = 'TFS';
  const quarter = summarizeAssignments('2026-10', people, assignments);
  assert.equal(quarter.capacityHours - before.capacityHours, 4.25);
  assert.equal(quarter.byPerson.find(row => row.id === freePerson.id).actualHours - before.byPerson.find(row => row.id === freePerson.id).actualHours, 4.25);
});

test('tenant default and daily override set the number and mix of planned duties', () => {
  const staffing = {
    defaultTarget: 5.5,
    defaultKey: ['F', 'F', 'T', 'T', 'S', 'KF'],
    overrides: { '2026-10-15': { target: 4, key: ['F', 'T', 'T', 'S'] } },
  };
  const plan = planTwoMonths('2026-10', people, {}, undefined, staffing);
  assert.equal(plan.error, undefined);
  assert.equal(plan.coverage, true);
  assert.equal(Object.values(plan.assignments['2026-10-15']).length, 4);
  assert.deepEqual(Object.values(plan.assignments['2026-10-15']).sort(), ['F', 'S', 'T', 'T']);
  assert.equal(Object.values(plan.assignments['2026-10-16']).filter(code => code === 'KF').length, 1);
  assert.equal(staffingStatus(plan.assignments['2026-10-16'], dailyRequirement(staffing, '2026-10-16')).units, 5.5);
});

test('half duty satisfies a 5.5 target without replacing the required base key', () => {
  const plan = planTwoMonths('2026-10', people);
  assert.equal(plan.error, undefined);
  const staffing = { ...DEFAULT_STAFFING, defaultTarget: 5.5 };
  const before = summarizeAssignments('2026-10', people, plan.assignments, undefined, staffing);
  assert.equal(before.coverage, false);
  const assignments = structuredClone(plan.assignments);
  const freePerson = people.find(person => !assignments['2026-10-15'][person.id]);
  assignments['2026-10-15'][freePerson.id] = 'KS';
  const status = staffingStatus(assignments['2026-10-15'], dailyRequirement(staffing, '2026-10-15'));
  assert.equal(status.complete, true);
  assert.equal(status.units, 5.5);
  assert.equal(status.missing.length, 0);
});

test('a daily target can omit the duty key and is still planned to its target', () => {
  const staffing = {
    ...DEFAULT_STAFFING,
    overrides: {
      '2026-10-15': { target: 4 },
      '2026-10-16': { target: 5.5, key: [] },
    },
  };
  assert.deepEqual(dailyRequirement(staffing, '2026-10-15'), { target: 4, key: [] });
  const plan = planTwoMonths('2026-10', people, {}, undefined, staffing);
  assert.equal(plan.error, undefined);
  assert.equal(plan.coverage, true);
  assert.equal(Object.values(plan.assignments['2026-10-15']).length, 4);
  assert.equal(staffingStatus(plan.assignments['2026-10-15'], dailyRequirement(staffing, '2026-10-15')).units, 4);
  assert.equal(Object.values(plan.assignments['2026-10-16']).length, 6);
  assert.equal(staffingStatus(plan.assignments['2026-10-16'], dailyRequirement(staffing, '2026-10-16')).units, 5.5);
});

test('insufficient team and vacation shortages still produce complete saved months', () => {
  const team = structuredClone(people.slice(0, 3));
  team[0].vacationRanges = [{ start: '2026-10-12', end: '2026-10-12' }];
  team[1].vacationRanges = [{ start: '2026-10-12', end: '2026-10-12' }];
  const plan = planTwoMonths('2026-10', team);
  assert.equal(plan.error, undefined);
  assert.equal(plan.dates.length, 61);
  assert.equal(Object.keys(plan.assignments).length, 61);
  assert.equal(Object.keys(plan.assignments['2026-10-12']).length, 1);
  assert.equal(plan.coverage, false);
  assert.ok(plan.shortageDays > 0);
  assert.ok(plan.byPerson.some(row => row.freeWeekends[0] < 2 || row.freeWeekends[1] < 2));
});

test('a team with no employees still gets an editable empty plan', () => {
  const plan = planTwoMonths('2026-10', []);
  assert.equal(plan.error, undefined);
  assert.equal(Object.keys(plan.assignments).length, 61);
  assert.equal(plan.assignedDuties, 0);
  assert.equal(plan.coverage, false);
});

test('an isolated vacation shortage does not remove free weekends elsewhere', () => {
  const team = structuredClone(people);
  team.slice(0, 8).forEach(person => { person.vacationRanges = [{ start: '2026-10-12', end: '2026-10-12' }]; });
  const plan = planTwoMonths('2026-10', team);
  assert.equal(plan.error, undefined);
  assert.equal(Object.keys(plan.assignments['2026-10-12']).length, 4);
  assert.equal(plan.shortageDays, 1);
  assert.ok(plan.byPerson.every(row => row.freeWeekends.every(count => count >= 2)));
});

const genericTypes = [
  { code: 'LANG', name: 'Langer Dienst', minutes: 480, coverage: null, weight: 0, staffingUnits: 1 },
  { code: 'KURZ', name: 'Kurzer Dienst', minutes: 240, coverage: null, weight: 0, staffingUnits: 1 },
];
const officeStaffing = { defaultTarget: 2, defaultKey: ['LANG', 'KURZ'], week: { 0: { target: 0, key: [] }, 6: { target: 0, key: [] } }, overrides: {} };
const fortyHours = { weeklyHours: 40, workdays: [1, 2, 3, 4, 5], holidays: [] };

test('an organisation can plan using only one half-unit duty type', () => {
  const types = [{ ...genericTypes[1], staffingUnits: 0.5 }];
  const staffing = { defaultTarget: 1.5, defaultKey: [], week: {}, overrides: {} };
  const plan = planTwoMonths('2026-10', people, {}, types, staffing, fortyHours);
  assert.equal(plan.error, undefined);
  assert.equal(plan.coverage, true);
  assert.ok(Object.values(plan.assignments).every(daily => Object.values(daily).length === 3 && Object.values(daily).every(code => code === 'KURZ')));
});

test('day exceptions override weekly patterns, including closed days and fallback to default', () => {
  const staffing = { ...officeStaffing, overrides: { '2026-10-04': { target: 1, key: ['KURZ'] } } };
  assert.deepEqual(dailyRequirement(staffing, '2026-10-03'), { target: 0, key: [] });
  assert.deepEqual(dailyRequirement(staffing, '2026-10-04'), { target: 1, key: ['KURZ'] });
  assert.deepEqual(dailyRequirement(staffing, '2026-10-05'), { target: 2, key: ['LANG', 'KURZ'] });
  const plan = planTwoMonths('2026-10', people, {}, genericTypes, staffing, fortyHours);
  assert.equal(plan.coverage, true);
  assert.deepEqual(plan.assignments['2026-10-03'], {});
  assert.deepEqual(Object.values(plan.assignments['2026-10-04']), ['KURZ']);
});

test('different duty durations balance actual minutes for fixed weekly hours', () => {
  const team = people.slice(0, 2).map((person, i) => ({ ...person, percent: 60, weeklyHours: i === 0 ? 40 : 20 }));
  const plan = planTwoMonths('2026-10', team, {}, genericTypes, officeStaffing, fortyHours);
  assert.equal(plan.coverage, true);
  assert.ok(plan.byPerson.every(person => Math.abs(person.balance) < 0.001));
  for (const daily of Object.values(plan.assignments).filter(daily => Object.keys(daily).length)) {
    assert.equal(daily[team[0].id], 'LANG');
    assert.equal(daily[team[1].id], 'KURZ');
  }
  const fixed = Object.fromEntries(Object.entries(plan.assignments).filter(([day]) => day.startsWith('2026-10')));
  const copy = structuredClone(fixed);
  const rolling = planTwoMonths('2026-10', team, fixed, genericTypes, officeStaffing, fortyHours);
  assert.deepEqual(fixed, copy);
  assert.deepEqual(Object.fromEntries(Object.entries(rolling.assignments).filter(([day]) => day.startsWith('2026-10'))), copy);
  assert.ok(rolling.byPerson.every(person => Math.abs(person.balance) < 0.001));
});

test('custom workdays and holidays change targets and paid vacation without closing staffing', () => {
  const model = { weeklyHours: 32, workdays: [1, 2, 3, 4], holidays: ['2026-10-05'] };
  const team = [{ ...people[0], percent: 50, vacationRanges: [{ start: '2026-10-05', end: '2026-10-11' }] }];
  const summary = summarizeAssignments('2026-10', team, {}, genericTypes, officeStaffing, model);
  const count = summary.dates.filter(day => [1, 2, 3, 4].includes(new Date(`${day}T00:00:00Z`).getUTCDay()) && day !== '2026-10-05').length;
  assert.equal(summary.byPerson[0].contractHours, count * 4);
  assert.equal(summary.byPerson[0].vacationHours, 12);
  assert.equal(summary.byPerson[0].annualVacation[2026], 3);
  assert.equal(dailyRequirement(officeStaffing, '2026-10-05').target, 2);
});

test('generic substitute duties never satisfy two requirements at once', () => {
  const types = [...genericTypes, { code: 'ERS', name: 'Ersatz', minutes: 480, coverage: 'LANG', weight: 1, staffingUnits: 1 }];
  assert.equal(staffingStatus({ a: 'ERS' }, { target: 1, key: ['LANG'] }, types).complete, true);
  assert.equal(staffingStatus({ a: 'ERS', b: 'KURZ' }, { target: 2, key: ['LANG', 'ERS'] }, types).complete, false);
  assert.equal(staffingStatus({ a: 'ERS', b: 'ERS' }, { target: 2, key: ['LANG', 'ERS'] }, types).complete, true);
});

const nightTypes = [
  { code: 'N', name: 'Nacht', minutes: 480, startTime: '22:00', endTime: '06:00', breakMinutes: 0, coverage: null, weight: 0, staffingUnits: 1 },
  { code: 'M', name: 'Morgen', minutes: 240, startTime: '05:00', endTime: '09:00', breakMinutes: 0, coverage: null, weight: 0, staffingUnits: 1 },
];
test('timed duties never overlap across midnight or extend into vacation', () => {
  const team = people.slice(0, 8).map(person => ({ ...person, vacationRanges: [{ start: '2026-10-15', end: '2026-10-15' }] }));
  const staffing = { defaultTarget: 2, defaultKey: ['N', 'M'], overrides: {}, week: {} };
  const plan = planTwoMonths('2026-10', team, {}, nightTypes, staffing, fortyHours);
  for (let i = 0; i < plan.dates.length - 1; i++) for (const person of team) {
    if (plan.assignments[plan.dates[i]][person.id] === 'N') assert.notEqual(plan.assignments[plan.dates[i + 1]][person.id], 'M');
  }
  assert.ok(!Object.values(plan.assignments['2026-10-14']).includes('N'));
  assert.deepEqual(plan.assignments['2026-10-15'], {});
});

test('a Friday night counts as worked on Saturday and adjacent fixed months constrain planning', () => {
  const team = [people[0]];
  const summary = summarizeAssignments('2026-10', team, { '2026-10-02': { [team[0].id]: 'N' } }, nightTypes, undefined, fortyHours);
  assert.equal(summary.byPerson[0].freeWeekends[0], 4);
  const fixed = { '2026-09-30': { [team[0].id]: 'N' } };
  const plan = planTwoMonths('2026-10', team, fixed, nightTypes, { defaultTarget: 1, defaultKey: ['M'], overrides: {}, week: {} }, fortyHours);
  assert.deepEqual(plan.assignments['2026-10-01'], {});
  assert.deepEqual(fixed, { '2026-09-30': { [team[0].id]: 'N' } });
});
