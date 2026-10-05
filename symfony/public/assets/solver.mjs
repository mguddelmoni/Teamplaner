const DAY_MS = 86400000;
export const DEFAULT_WORK_MODEL = { weeklyHours: 42, workdays: [1, 2, 3, 4, 5], holidays: [] };
export const DEFAULT_SHIFT_TYPES = [
  { code: 'F', name: 'Frühdienst', minutes: 504, coverage: 'F', weight: 1, staffingUnits: 1 },
  { code: 'T', name: 'Tagdienst', minutes: 504, coverage: 'T', weight: 1, staffingUnits: 1 },
  { code: 'S', name: 'Spätdienst', minutes: 504, coverage: 'S', weight: 1, staffingUnits: 1 },
  { code: 'KF', name: 'Kurz Früh', minutes: 240, coverage: null, weight: 0, staffingUnits: 0.5 },
  { code: 'KS', name: 'Kurz Spät', minutes: 240, coverage: null, weight: 0, staffingUnits: 0.5 },
  { code: 'TFS', name: 'Teilter Spätdienst', minutes: 255, coverage: null, weight: 0, staffingUnits: 0.5 },
];
export const DEFAULT_STAFFING = { defaultTarget: 5, defaultKey: ['F', 'F', 'T', 'T', 'S'], week: {}, overrides: {} };
const shiftMap = types => Object.fromEntries(types.map(type => [type.code, type]));
export const dailyRequirement = (staffing, day) => {
  const override = staffing?.overrides?.[day] ?? staffing?.week?.[new Date(`${day}T00:00:00Z`).getUTCDay()];
  return override ? { target: override.target, key: override.key || [] }
    : { target: staffing?.defaultTarget ?? 5, key: staffing?.defaultKey || DEFAULT_STAFFING.defaultKey };
};
export function planningKey(staffing, day, types = DEFAULT_SHIFT_TYPES) {
  const requirement = dailyRequirement(staffing, day);
  const byCode = shiftMap(types);
  const roles = [...requirement.key];
  let missing = requirement.target - roles.reduce((sum, code) => sum + (byCode[code]?.staffingUnits || 0), 0);
  if (missing < -1e-8) throw new Error(`Am ${day} ist der Dienstschlüssel grösser als das Tagespensum.`);
  const remaining = new Map();
  for (const code of staffing?.defaultKey || DEFAULT_STAFFING.defaultKey) {
    if (byCode[code]?.staffingUnits === 1) remaining.set(code, (remaining.get(code) || 0) + 1);
  }
  const fullPool = [];
  while ([...remaining.values()].some(count => count > 0)) {
    for (const [code, count] of remaining) if (count > 0) { fullPool.push(code); remaining.set(code, count - 1); }
  }
  if (!fullPool.length) fullPool.push(...types.filter(type => type.staffingUnits === 1).map(type => type.code));
  const half = (staffing?.defaultKey || []).find(code => byCode[code]?.staffingUnits === 0.5)
    || types.find(type => type.staffingUnits === 0.5)?.code;
  if (missing >= 1 && !fullPool.length && !half) throw new Error(`Am ${day} fehlt ein Diensttyp mit Besetzungsanteil für das Tagespensum.`);
  let fullIndex = 0;
  while (fullPool.length && missing >= 1 - 1e-8) { roles.push(fullPool[fullIndex++ % fullPool.length]); missing -= 1; }
  while (missing >= 0.5 - 1e-8) {
    if (!half) throw new Error(`Am ${day} fehlt ein halber Diensttyp für das Tagespensum.`);
    roles.push(half); missing -= 0.5;
  }
  return roles;
}
export function staffingStatus(daily, requirement, types = DEFAULT_SHIFT_TYPES) {
  const byCode = shiftMap(types);
  const codes = Object.values(daily || {});
  const units = codes.reduce((sum, code) => sum + (byCode[code]?.staffingUnits ?? (['F', 'T', 'S'].includes(code) ? 1 : 0.5)), 0);
  const needed = {};
  for (const code of requirement.key) needed[code] = (needed[code] || 0) + 1;
  // Reserve explicitly requested duties first. Only surplus duties can replace
  // another type, so one person cannot satisfy two required duties at once.
  const remaining = { ...needed }, surplus = [];
  for (const code of codes) {
    const type = byCode[code];
    if (remaining[code] > 0) remaining[code] -= type?.coverage === code ? type.weight : 1;
    else surplus.push(type);
  }
  for (const type of surplus) if (type?.coverage && remaining[type.coverage] > 0) remaining[type.coverage] -= type.weight;
  const missing = Object.entries(needed).filter(([code]) => remaining[code] > 1e-8).map(([code, count]) => `${code} ${count}`);
  return { units, target: requirement.target, missing, complete: units + 1e-8 >= requirement.target && missing.length === 0 };
}
const key = (date) => date.toISOString().slice(0, 10);
const utcDate = (year, monthIndex, day) => new Date(Date.UTC(year, monthIndex, day));
const inRange = (dateKey, range) => dateKey >= range.start && dateKey <= range.end;
const isVacation = (person, dateKey) => person.vacationRanges.some(range => inRange(dateKey, range));
const isWish = (person, date) => person.weeklyOff.includes(date.getUTCDay()) || person.offDates.includes(key(date));

export function workHours(person, dates, model = DEFAULT_WORK_MODEL) {
  const weeklyHours = person.weeklyHours ?? model.weeklyHours;
  const effectiveHours = person.weeklyHours == null ? weeklyHours * person.percent / 100 : weeklyHours;
  const workdays = dates.filter(day => model.workdays.includes(day.getUTCDay()) && !(model.holidays || []).includes(key(day)));
  const dailyHours = effectiveHours / model.workdays.length;
  const contractHours = workdays.length * dailyHours;
  const vacationHours = workdays.filter(day => isVacation(person, key(day))).length * dailyHours;
  return { contractHours, vacationHours, desiredMinutes: (contractHours - vacationHours) * 60 };
}

const clockMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const spansNextDay = type => Boolean(type?.startTime && type?.endTime && type.endTime <= type.startTime && type.endTime !== '00:00');
const worksOnDay = (assignments, day, personId, byCode) => {
  const previous = key(new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS));
  return Boolean(assignments[day]?.[personId] || spansNextDay(byCode[assignments[previous]?.[personId]]));
};
function interval(day, type) {
  if (!type?.startTime || !type?.endTime) return null;
  const start = clockMinutes(type.startTime), end = clockMinutes(type.endTime);
  const midnight = Date.parse(`${day}T00:00:00Z`) / 60000;
  return [midnight + start, midnight + end + (end <= start ? 1440 : 0)];
}
function canAssign(person, day, code, assignments, byCode, freeDays) {
  if (!code) return true;
  const date = new Date(`${day}T00:00:00Z`);
  const next = key(new Date(date.getTime() + DAY_MS));
  if (isVacation(person, day) || freeDays.get(person.id)?.has(day)) return false;
  if (spansNextDay(byCode[code]) && (isVacation(person, next) || freeDays.get(person.id)?.has(next))) return false;
  const time = interval(day, byCode[code]);
  if (time) for (const offset of [-1, 1]) {
    const neighbor = key(new Date(date.getTime() + offset * DAY_MS));
    const other = interval(neighbor, byCode[assignments[neighbor]?.[person.id]]);
    if (other && time[0] < other[1] && other[0] < time[1]) return false;
  }
  return true;
}

function dateSpan(month, numberOfMonths = 2) {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = utcDate(year, monthNumber - 1, 1);
  const end = utcDate(year, monthNumber - 1 + numberOfMonths, 0);
  const dates = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) dates.push(new Date(t));
  return dates;
}

function weekendsForMonth(year, monthIndex) {
  const result = [];
  const last = utcDate(year, monthIndex + 1, 0).getUTCDate();
  for (let day = 1; day <= last; day++) {
    const saturday = utcDate(year, monthIndex, day);
    if (saturday.getUTCDay() !== 6) continue;
    const sunday = new Date(saturday.getTime() + DAY_MS);
    result.push([key(saturday), key(sunday)]);
  }
  return result;
}

function random(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function chooseFreeWeekends(people, dates, months, fixedAssignments, roleKeys, byCode) {
  const byMonth = months.map(({ year, monthIndex }) => weekendsForMonth(year, monthIndex));
  const fixedDays = new Set(Object.keys(fixedAssignments));
  const fixedMonths = months.map(({ year, monthIndex }) => {
    const monthKey = key(utcDate(year, monthIndex, 1)).slice(0, 7);
    return dates.filter(day => key(day).startsWith(monthKey)).every(day => fixedDays.has(key(day)));
  });
  if (byMonth.some(list => list.length < 2)) return null;

  for (let attempt = 0; attempt < 400; attempt++) {
    const rng = random(4817 + attempt * 7919 + dates.length);
    const free = new Map(people.map(person => [person.id, new Set()]));
    let possible = true;
    for (let monthNumber = 0; monthNumber < byMonth.length; monthNumber++) {
      if (fixedMonths[monthNumber]) continue;
      const weekends = byMonth[monthNumber];
      const load = weekends.map(() => 0);
      const order = [...people.keys()];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (const personIndex of order) {
        const person = people[personIndex];
        const options = weekends.map(([sat, sun], index) => {
          const vacations = Number(isVacation(person, sat)) + Number(isVacation(person, sun));
          const wishes = Number(person.offDates.includes(sat)) + Number(person.offDates.includes(sun));
          const weekendWish = Number(person.weeklyOff.includes(6)) + Number(person.weeklyOff.includes(0));
          return { index, cost: load[index] * 12 - vacations * 8 - wishes * 5 - weekendWish * 2 + rng() * 6 };
        }).sort((a, b) => a.cost - b.cost);
        let picked = 0;
        for (const option of options) {
          const [sat, sun] = weekends[option.index];
          const weekendDemand = Math.max(roleKeys.get(sat)?.length || 0, roleKeys.get(sun)?.length || 0);
          if (load[option.index] >= people.length - weekendDemand) continue;
          if (worksOnDay(fixedAssignments, sat, person.id, byCode) || worksOnDay(fixedAssignments, sun, person.id, byCode)) continue;
          free.get(person.id).add(sat);
          free.get(person.id).add(sun);
          load[option.index]++;
          picked++;
          if (picked === 2) break;
        }
        if (picked < 2) { possible = false; break; }
      }
      if (!possible) break;
    }
    if (!possible) continue;
    if (fixedMonths[0] && !fixedMonths[1]) {
      const [lastSat, lastSun] = byMonth[0][byMonth[0].length - 1];
      if (lastSun.slice(0, 7) !== lastSat.slice(0, 7)) {
        for (const person of people) {
          const earlierFree = byMonth[0].slice(0, -1).filter(([sat, sun]) => !worksOnDay(fixedAssignments, sat, person.id, byCode) && !worksOnDay(fixedAssignments, sun, person.id, byCode)).length;
          if (earlierFree < 2 && !worksOnDay(fixedAssignments, lastSat, person.id, byCode)) free.get(person.id).add(lastSun);
        }
      }
    }
    if (dates.filter(date => !fixedDays.has(key(date))).every(date => {
      const day = key(date);
      const available = people.filter(person => !isVacation(person, day)).length;
      const remaining = people.filter(person => !free.get(person.id).has(day) && !isVacation(person, day)).length;
      return remaining >= Math.min(available, roleKeys.get(day).length);
    })) {
      return { free, byMonth };
    }
  }
  return null;
}

class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    const a = this.items; a.push(item); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= item[0]) break; a[i] = a[p]; i = p; }
    a[i] = item;
  }
  pop() {
    const a = this.items; const top = a[0]; const last = a.pop();
    if (a.length) { let i = 0; while (true) { let child = i * 2 + 1; if (child >= a.length) break; if (child + 1 < a.length && a[child + 1][0] < a[child][0]) child++; if (a[child][0] >= last[0]) break; a[i] = a[child]; i = child; } a[i] = last; }
    return top;
  }
  get length() { return this.items.length; }
}

class MinCostFlow {
  constructor(size) { this.graph = Array.from({ length: size }, () => []); }
  add(from, to, capacity, cost) {
    const a = { to, rev: this.graph[to].length, cap: capacity, cost };
    const b = { to: from, rev: this.graph[from].length, cap: 0, cost: -cost };
    this.graph[from].push(a); this.graph[to].push(b);
    return a;
  }
  solve(source, sink, demand) {
    const n = this.graph.length, potential = Array(n).fill(0);
    let flow = 0, cost = 0;
    while (flow < demand) {
      const dist = Array(n).fill(Infinity), prevNode = Array(n).fill(-1), prevEdge = Array(n).fill(-1);
      const heap = new MinHeap(); dist[source] = 0; heap.push([0, source]);
      while (heap.length) {
        const [value, node] = heap.pop(); if (value !== dist[node]) continue;
        for (let i = 0; i < this.graph[node].length; i++) {
          const edge = this.graph[node][i]; if (!edge.cap) continue;
          const next = value + edge.cost + potential[node] - potential[edge.to];
          if (next < dist[edge.to]) { dist[edge.to] = next; prevNode[edge.to] = node; prevEdge[edge.to] = i; heap.push([next, edge.to]); }
        }
      }
      if (!Number.isFinite(dist[sink])) break;
      for (let node = 0; node < n; node++) if (Number.isFinite(dist[node])) potential[node] += dist[node];
      let augment = demand - flow;
      for (let node = sink; node !== source; node = prevNode[node]) augment = Math.min(augment, this.graph[prevNode[node]][prevEdge[node]].cap);
      for (let node = sink; node !== source; node = prevNode[node]) {
        const edge = this.graph[prevNode[node]][prevEdge[node]];
        edge.cap -= augment; this.graph[node][edge.rev].cap += augment; cost += edge.cost * augment;
      }
      flow += augment;
    }
    return { flow, cost };
  }
}

function assignRoles(dayPeople, people, roleTotals, date, roleKey, byCode, targets, workedMinutes, assignments, freeDays) {
  const dateKey = key(date);
  // Include fallback workers when selected workers cannot cover a timed duty.
  const preferred = new Set(dayPeople);
  dayPeople = people.map((_, index) => index).filter(index => roleKey.some(code => canAssign(people[index], dateKey, code, assignments, byCode, freeDays)));
  const count = roleKey.length, workerCount = dayPeople.length;
  const network = new MinCostFlow(2 + workerCount + count);
  const source = 0, firstPerson = 1, firstRole = firstPerson + workerCount, sink = firstRole + count;
  const edges = [];
  const roleShare = Object.fromEntries([...new Set(roleKey)].map(code => [code, roleKey.filter(role => role === code).length / count]));
  for (let i = 0; i < workerCount; i++) {
    const person = people[dayPeople[i]];
    network.add(source, firstPerson + i, 1, 0);
    for (let j = 0; j < count; j++) {
      const shift = roleKey[j];
      if (!canAssign(person, dateKey, shift, assignments, byCode, freeDays)) continue;
      const priorCount = roleTotals[person.id][shift] || 0;
      const balanceCost = 4 * (2 * priorCount + 1 - 2 * (roleTotals[person.id].total + 1) * roleShare[shift]);
      const hours = byCode[shift].minutes / 60;
      const deficit = (workedMinutes[dayPeople[i]] - targets[dayPeople[i]].desiredMinutes) / 60;
      const minuteCost = 4 * (2 * deficit * hours + hours * hours);
      const cost = Math.round(10000000 + minuteCost + balanceCost + (preferred.has(dayPeople[i]) ? 0 : 1000000)
        + (person.avoid.includes(shift) ? 1000 : 0) + (isWish(person, date) ? 2500 : 0));
      edges.push({ personIndex: i, roleIndex: j, edge: network.add(firstPerson + i, firstRole + j, 1, cost) });
    }
  }
  for (let j = 0; j < count; j++) network.add(firstRole + j, sink, 1, 0);
  network.solve(source, sink, workerCount);
  const assigned = {};
  for (const { personIndex, roleIndex, edge } of edges.filter(item => item.edge.cap === 0)) {
    const person = people[dayPeople[personIndex]], shift = roleKey[roleIndex];
    assigned[person.id] = shift;
    roleTotals[person.id][shift] = (roleTotals[person.id][shift] || 0) + 1;
    roleTotals[person.id].total++;
    workedMinutes[dayPeople[personIndex]] += byCode[shift].minutes;
  }
  return { dateKey, assigned };
}

// Improve the actual hour balance by moving or swapping duties on the same day.
// Fixed days, vacations, reserved weekends and timed overlaps remain untouched.
function balanceMinutes(dates, people, assignments, byCode, targets, workedMinutes, freeDays) {
  const hourCost = (index, delta) => ((workedMinutes[index] + delta - targets[index].desiredMinutes) / 60) ** 2;
  const preferenceCost = (person, day, code) => !code ? 0 : (isWish(person, day) ? 100 : 0) + (person.avoid.includes(code) ? 40 : 0);
  for (let pass = 0; pass < 20; pass++) {
    let improved = false;
    for (const date of dates) {
      const day = key(date), daily = assignments[day];
      let best = null, bestGain = -0.0001;
      for (let a = 0; a < people.length; a++) for (let b = a + 1; b < people.length; b++) {
        const first = daily[people[a].id], second = daily[people[b].id];
        if (first === second) continue;
        const delta = (byCode[second]?.minutes || 0) - (byCode[first]?.minutes || 0);
        const gain = hourCost(a, delta) + hourCost(b, -delta) - hourCost(a, 0) - hourCost(b, 0)
          + preferenceCost(people[a], date, second) + preferenceCost(people[b], date, first)
          - preferenceCost(people[a], date, first) - preferenceCost(people[b], date, second);
        if (gain >= bestGain || !canAssign(people[a], day, second, assignments, byCode, freeDays) || !canAssign(people[b], day, first, assignments, byCode, freeDays)) continue;
        bestGain = gain; best = { a, b, first, second, delta };
      }
      if (best) {
        const { a, b, first, second, delta } = best;
        if (second) daily[people[a].id] = second; else delete daily[people[a].id];
        if (first) daily[people[b].id] = first; else delete daily[people[b].id];
        workedMinutes[a] += delta; workedMinutes[b] -= delta; improved = true;
      }
    }
    if (!improved) break;
  }
}

export function planTwoMonths(startMonth, people, fixedAssignments = {}, shiftTypes = DEFAULT_SHIFT_TYPES, staffing = DEFAULT_STAFFING, workModel = DEFAULT_WORK_MODEL) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) return { error: 'Bitte einen gültigen Startmonat wählen.' };
  const dates = dateSpan(startMonth);
  let roleKeys;
  try { roleKeys = new Map(dates.map(day => [key(day), planningKey(staffing, key(day), shiftTypes)])); }
  catch (error) { return { error: error.message }; }
  const maxDemand = Math.max(...dates.map(day => roleKeys.get(key(day)).length));
  if (new Set(people.map(person => person.id)).size !== people.length) return { error: 'Jede Person benötigt eine eindeutige Kennung.' };
  if (people.some(person => !Number.isInteger(person.percent) || person.percent < 10 || person.percent > 100)) return { error: 'Jedes Pensum muss eine ganze Zahl zwischen 10 und 100 Prozent sein.' };
  const [year, monthNumber] = startMonth.split('-').map(Number);
  if (!year) return { error: 'Bitte einen gültigen Startmonat wählen.' };
  const fixedDays = new Set(dates.map(key).filter(day => Object.hasOwn(fixedAssignments, day)));
  const newDates = dates.filter(day => !fixedDays.has(key(day)));
  const nextDate = utcDate(year, monthNumber, 1);
  const months = [{ year, monthIndex: monthNumber - 1 }, { year: nextDate.getUTCFullYear(), monthIndex: nextDate.getUTCMonth() }];
  const byCode = shiftMap(shiftTypes);
  const weekendChoice = people.length >= maxDemand
    ? chooseFreeWeekends(people, dates, months, fixedAssignments, roleKeys, byCode)
    : null;
  const freeDays = weekendChoice?.free || new Map(people.map(person => [person.id, new Set()]));

  const targets = people.map(person => workHours(person, dates, workModel));
  const plannedCodes = newDates.flatMap(day => roleKeys.get(key(day)));
  const averageMinutes = plannedCodes.length ? plannedCodes.reduce((sum, code) => sum + byCode[code].minutes, 0) / plannedCodes.length : 1;
  const workedMinutes = people.map(person => dates.reduce((sum, date) => sum + (byCode[fixedAssignments[key(date)]?.[person.id]]?.minutes || 0), 0));
  const source = 0, firstPerson = 1, firstDay = firstPerson + people.length, sink = firstDay + newDates.length;
  const network = new MinCostFlow(sink + 1);
  const dayEdges = people.map(() => []);
  for (let personIndex = 0; personIndex < people.length; personIndex++) {
    const person = people[personIndex];
    const available = newDates.filter(date => !isVacation(person, key(date)) && !freeDays.get(person.id).has(key(date))).length;
    const fixedShifts = workedMinutes[personIndex] / averageMinutes;
    const target = targets[personIndex].desiredMinutes / averageMinutes;
    for (let shiftNumber = 1; shiftNumber <= available; shiftNumber++) {
      const marginal = Math.round(300 * (2 * (fixedShifts + shiftNumber) - 1 - 2 * target));
      network.add(source, firstPerson + personIndex, 1, 10000000 + marginal);
    }
    for (let dayIndex = 0; dayIndex < newDates.length; dayIndex++) {
      const date = newDates[dayIndex];
      if (isVacation(person, key(date)) || freeDays.get(person.id).has(key(date))) continue;
      const preferenceCost = isWish(person, date) ? 2500 : 0;
      const edge = network.add(firstPerson + personIndex, firstDay + dayIndex, 1, preferenceCost);
      dayEdges[personIndex].push({ dayIndex, edge });
    }
  }
  const totalDemand = newDates.reduce((sum, day) => sum + roleKeys.get(key(day)).length, 0);
  for (let dayIndex = 0; dayIndex < newDates.length; dayIndex++) network.add(firstDay + dayIndex, sink, roleKeys.get(key(newDates[dayIndex])).length, 0);
  network.solve(source, sink, totalDemand);
  const workersByDay = newDates.map(() => []);
  dayEdges.forEach((edges, personIndex) => edges.forEach(({ dayIndex, edge }) => { if (edge.cap === 0) workersByDay[dayIndex].push(personIndex); }));

  const assignments = Object.fromEntries(dates.filter(date => fixedDays.has(key(date))).map(date => [key(date), fixedAssignments[key(date)]]));
  const roleTotals = Object.fromEntries(people.map(person => [person.id, { total: 0 }]));
  for (const daily of Object.values(assignments)) for (const [id, shift] of Object.entries(daily)) {
    if (!roleTotals[id]) continue;
    roleTotals[id][shift] = (roleTotals[id][shift] || 0) + 1; roleTotals[id].total++;
  }
  let newDayIndex = 0;
  const context = { ...fixedAssignments, ...assignments };
  for (const date of dates) {
    if (fixedDays.has(key(date))) continue;
    const { dateKey, assigned } = assignRoles(workersByDay[newDayIndex++], people, roleTotals, date, roleKeys.get(key(date)), byCode, targets, workedMinutes, context, freeDays);
    assignments[dateKey] = assigned; context[dateKey] = assigned;
  }
  balanceMinutes(newDates, people, context, byCode, targets, workedMinutes, freeDays);
  return { ...summarizeAssignments(startMonth, people, context, shiftTypes, staffing, workModel), assignments };
}

// Rebuild derived balances after a stored plan or an approved same-day swap.
export function summarizeAssignments(startMonth, people, assignments, shiftTypes = DEFAULT_SHIFT_TYPES, staffing = DEFAULT_STAFFING, workModel = DEFAULT_WORK_MODEL) {
  const dates = dateSpan(startMonth);
  const byCode = shiftMap(shiftTypes);
  const [year, monthNumber] = startMonth.split('-').map(Number);
  const months = [
    { year, monthIndex: monthNumber - 1 },
    { year: utcDate(year, monthNumber, 1).getUTCFullYear(), monthIndex: utcDate(year, monthNumber, 1).getUTCMonth() },
  ];
  const weekends = months.map(({ year: y, monthIndex }) => weekendsForMonth(y, monthIndex));
  const violations = [];
  const byPerson = people.map(person => {
    const { contractHours, vacationHours } = workHours(person, dates, workModel);
    const shifts = dates.filter(day => Boolean(assignments[key(day)]?.[person.id])).length;
    const workedMinutes = dates.reduce((sum, day) => sum + (byCode[assignments[key(day)]?.[person.id]]?.minutes || 0), 0);
    const actualHours = workedMinutes / 60 + vacationHours;
    const balance = actualHours - contractHours;
    const wishedOffWorked = dates.filter(day => isWish(person, day) && assignments[key(day)]?.[person.id]).map(key);
    const avoided = dates.filter(day => person.avoid.includes(assignments[key(day)]?.[person.id])).map(day => ({ date: key(day), shift: assignments[key(day)][person.id] }));
    const freeWeekends = weekends.map(list => list.filter(([sat, sun]) => !worksOnDay(assignments, sat, person.id, byCode) && !worksOnDay(assignments, sun, person.id, byCode)).length);
    const annualVacation = {};
    dates.forEach(day => {
      if (!workModel.workdays.includes(day.getUTCDay()) || (workModel.holidays || []).includes(key(day)) || !isVacation(person, key(day))) return;
      annualVacation[day.getUTCFullYear()] = (annualVacation[day.getUTCFullYear()] || 0) + 1;
    });
    if (wishedOffWorked.length) violations.push(`${person.name}: ${wishedOffWorked.length} Freiwunsch-Tage wurden verplant.`);
    if (avoided.length) violations.push(`${person.name}: ${avoided.length} unerwünschte Diensttypen wurden vergeben.`);
    if (freeWeekends.some(count => count < 2)) violations.push(`${person.name}: weniger als zwei komplette freie Wochenenden in einem Monat.`);
    if (Number.isFinite(person.vacationWeeks) && Object.values(annualVacation).some(days => days / workModel.workdays.length > person.vacationWeeks + 1e-8)) violations.push(`${person.name}: Die Ferien im Planungszeitraum überschreiten die angegebenen Jahreswochen.`);
    return { id: person.id, name: person.name, percent: person.percent, weeklyHours: person.weeklyHours, shifts, contractHours, vacationHours, actualHours, balance, wishedOffWorked, avoided, freeWeekends, annualVacation };
  });
  const dailyStatus = dates.map(day => staffingStatus(assignments[key(day)], dailyRequirement(staffing, key(day)), shiftTypes));
  const coverage = dailyStatus.every(status => status.complete);
  return {
    startMonth, dates: dates.map(key), assignments, byPerson, coverage,
    shortageDays: dailyStatus.filter(status => !status.complete).length,
    exactPensum: byPerson.every(row => Math.abs(row.balance) < 0.005), violations,
    requiredDuties: dailyStatus.reduce((sum, status) => sum + status.target, 0),
    assignedDuties: dailyStatus.reduce((sum, status) => sum + Math.min(status.units, status.target), 0),
    capacityHours: dates.reduce((sum, day) => sum + Object.values(assignments[key(day)] || {}).reduce((daily, code) => daily + (byCode[code]?.minutes || 0) / 60, 0), 0),
    contractHours: byPerson.reduce((sum, row) => sum + row.contractHours, 0),
    vacationHours: byPerson.reduce((sum, row) => sum + row.vacationHours, 0),
  };
}
