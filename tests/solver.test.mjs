import test from 'node:test';
import assert from 'node:assert/strict';
import { planTwoMonths } from '../dist/solver.mjs';

const names = ['Emma Schmid','Felix Weber','Anna Meier','Ben Keller','Clara Roth','David Fischer','Eva Baumann','Farid Huber','Gina Müller','Hugo Steiner','Ida Graf','Jonas Frei'];
const percents = [100,100,40,40,40,40,60,60,60,60,60,60];
function people() { return names.map((name, index) => ({id: String(index),name,percent:percents[index],vacationWeeks:5,weeklyOff:[],offDates:[],vacationRanges:[],avoid:[]})); }
function assertCoverage(plan) {
  assert.equal(plan.error, undefined);
  assert.equal(plan.assignedDuties, plan.requiredDuties);
  for (const day of plan.dates) {
    const roles = Object.values(plan.assignments[day]);
    assert.deepEqual(['S','T','T','F','F'], roles.sort((a,b) => ({S:0,T:1,F:2}[a]-{S:0,T:1,F:2}[b])));
  }
  for (const row of plan.byPerson) assert.ok(row.freeWeekends.every(number => number >= 2), row.name);
}
test('default data cover two full months and disclose impossible exact total', () => {
  const plan = planTwoMonths('2026-10', people());
  assertCoverage(plan);
  assert.equal(plan.dates.length, 61);
  assert.equal(plan.exactPensum, false);
  assert.ok(plan.contractHours > plan.capacityHours);
  assert.ok(plan.byPerson.some(row => row.balance < 0));
});
test('vacation is hard and credited as paid hours', () => {
  const team = people();
  team[0].vacationRanges = [{start:'2026-10-19',end:'2026-10-25'}];
  const plan = planTwoMonths('2026-10', team);
  assertCoverage(plan);
  for (const day of plan.dates.filter(day => day >= '2026-10-19' && day <= '2026-10-25')) assert.equal(plan.assignments[day][team[0].id], undefined);
  assert.equal(plan.byPerson[0].vacationHours, 42);
});
test('ten percent is accepted and nine percent is rejected', () => {
  const team = people(); team[0].percent = 10;
  assertCoverage(planTwoMonths('2026-10', team));
  team[0].percent = 9;
  assert.match(planTwoMonths('2026-10', team).error, /10 und 100/);
});
test('hard vacation conflict cannot be declared covered', () => {
  const team = people();
  team.slice(0, 8).forEach(person => person.vacationRanges = [{start:'2026-10-12',end:'2026-10-12'}]);
  const plan = planTwoMonths('2026-10', team);
  assert.match(plan.error, /2026-10-12/);
  assert.equal(plan.coverage, undefined);
});
test('cross-month weekend is counted with both days off', () => {
  const plan = planTwoMonths('2026-10', people());
  assertCoverage(plan);
  for (const row of plan.byPerson) {
    let count = 0;
    for (const saturday of ['2026-10-03','2026-10-10','2026-10-17','2026-10-24','2026-10-31']) {
      const sunday = new Date(new Date(`${saturday}T00:00:00.000Z`).getTime() + 86400000).toISOString().slice(0,10);
      if (!plan.assignments[saturday][row.id] && !plan.assignments[sunday][row.id]) count++;
    }
    assert.equal(row.freeWeekends[0], count);
  }
});
test('overridden role exclusions and off wishes are reported', () => {
  const team = people();
  team.forEach(person => { person.avoid = ['S','T','F']; person.weeklyOff = [1]; });
  const plan = planTwoMonths('2026-10', team);
  assertCoverage(plan);
  assert.ok(plan.violations.some(warning => warning.includes('unerwünschte Diensttypen')));
  assert.ok(plan.violations.some(warning => warning.includes('Freiwunsch-Tage')));
});
