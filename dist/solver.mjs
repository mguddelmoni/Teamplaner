const DAY_MS = 86400000;
const SHIFT_HOURS = 8.4;
const key = (date) => date.toISOString().slice(0, 10);
const utcDate = (year, monthIndex, day) => new Date(Date.UTC(year, monthIndex, day));
const inRange = (dateKey, range) => dateKey >= range.start && dateKey <= range.end;
const isVacation = (person, dateKey) => person.vacationRanges.some(range => inRange(dateKey, range));
const isWish = (person, date) => person.weeklyOff.includes(date.getUTCDay()) || person.offDates.includes(key(date));

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

function chooseFreeWeekends(people, dates, months) {
  const byMonth = months.map(({ year, monthIndex }) => weekendsForMonth(year, monthIndex));
  if (byMonth.some(list => list.length < 2)) return null;

  for (let attempt = 0; attempt < 400; attempt++) {
    const rng = random(4817 + attempt * 7919 + dates.length);
    const free = new Map(people.map(person => [person.id, new Set()]));
    let possible = true;
    for (const weekends of byMonth) {
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
          if (load[option.index] >= people.length - 5) continue;
          const [sat, sun] = weekends[option.index];
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
    if (dates.every(date => people.filter(person => !free.get(person.id).has(key(date)) && !isVacation(person, key(date))).length >= 5)) {
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

function assignRoles(dayPeople, people, priorRoles, roleTotals, date) {
  let best = null;
  const dateKey = key(date);
  for (let s = 0; s < 5; s++) {
    for (let t1 = 0; t1 < 5; t1++) for (let t2 = t1 + 1; t2 < 5; t2++) {
      if (t1 === s || t2 === s) continue;
      const roles = dayPeople.map((_, i) => i === s ? 'S' : i === t1 || i === t2 ? 'T' : 'F');
      let cost = 0;
      for (let i = 0; i < 5; i++) {
        const person = people[dayPeople[i]], shift = roles[i];
        if (person.avoid.includes(shift)) cost += 1000;
        if (priorRoles[person.id] === 'S' && shift !== 'S') cost += 25;
        const count = roleTotals[person.id][shift];
        cost += 4 * (2 * count + 1 - 2 * (roleTotals[person.id].total + 1) * (shift === 'S' ? 0.2 : 0.4));
        if (isWish(person, date)) cost += 20;
      }
      if (!best || cost < best.cost) best = { cost, roles };
    }
  }
  const assigned = {};
  for (let i = 0; i < 5; i++) {
    const person = people[dayPeople[i]], shift = best.roles[i];
    assigned[person.id] = shift;
    roleTotals[person.id][shift]++;
    roleTotals[person.id].total++;
  }
  return { dateKey, assigned };
}

export function planTwoMonths(startMonth, people) {
  if (people.length < 5) return { error: 'Mindestens fünf Personen sind für fünf tägliche Dienste nötig.' };
  if (new Set(people.map(person => person.id)).size !== people.length) return { error: 'Jede Person benötigt eine eindeutige Kennung.' };
  if (people.some(person => !Number.isInteger(person.percent) || person.percent < 10 || person.percent > 100)) return { error: 'Jedes Pensum muss eine ganze Zahl zwischen 10 und 100 Prozent sein.' };
  const [year, monthNumber] = startMonth.split('-').map(Number);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth) || !year) return { error: 'Bitte einen gültigen Startmonat wählen.' };
  const dates = dateSpan(startMonth);
  const nextDate = utcDate(year, monthNumber, 1);
  const months = [{ year, monthIndex: monthNumber - 1 }, { year: nextDate.getUTCFullYear(), monthIndex: nextDate.getUTCMonth() }];
  const weekendChoice = chooseFreeWeekends(people, dates, months);
  const unavailable = dates.find(date => people.filter(person => !isVacation(person, key(date))).length < 5);
  if (unavailable) return { error: `Am ${key(unavailable)} sind wegen Ferien weniger als fünf Personen verfügbar.` };
  if (!weekendChoice) return { error: 'Mit den Ferien und zwei kompletten freien Wochenenden pro Person konnte kein durchgehend besetzter Plan gefunden werden. Bitte Teamgrösse oder Ferien prüfen.' };

  const weekdayCount = dates.filter(date => date.getUTCDay() !== 0 && date.getUTCDay() !== 6).length;
  const targets = people.map(person => {
    const vacationWeekdays = dates.filter(date => date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && isVacation(person, key(date))).length;
    const contractHours = weekdayCount * SHIFT_HOURS * person.percent / 100;
    const vacationHours = vacationWeekdays * SHIFT_HOURS * person.percent / 100;
    return { contractHours, vacationHours, desiredShifts: (contractHours - vacationHours) / SHIFT_HOURS };
  });
  const source = 0, firstPerson = 1, firstDay = firstPerson + people.length, sink = firstDay + dates.length;
  const network = new MinCostFlow(sink + 1);
  const dayEdges = people.map(() => []);
  for (let personIndex = 0; personIndex < people.length; personIndex++) {
    const person = people[personIndex];
    const available = dates.filter(date => !isVacation(person, key(date)) && !weekendChoice.free.get(person.id).has(key(date))).length;
    const target = targets[personIndex].desiredShifts;
    for (let shiftNumber = 1; shiftNumber <= available; shiftNumber++) {
      const marginal = Math.round(300 * (2 * shiftNumber - 1 - 2 * target));
      network.add(source, firstPerson + personIndex, 1, 30000 + marginal);
    }
    for (let dayIndex = 0; dayIndex < dates.length; dayIndex++) {
      const date = dates[dayIndex];
      if (isVacation(person, key(date)) || weekendChoice.free.get(person.id).has(key(date))) continue;
      const preferenceCost = isWish(person, date) ? 2500 : 0;
      const edge = network.add(firstPerson + personIndex, firstDay + dayIndex, 1, preferenceCost);
      dayEdges[personIndex].push({ dayIndex, edge });
    }
  }
  for (let dayIndex = 0; dayIndex < dates.length; dayIndex++) network.add(firstDay + dayIndex, sink, 5, 0);
  const result = network.solve(source, sink, dates.length * 5);
  if (result.flow !== dates.length * 5) return { error: 'Mit Ferien und freien Wochenenden konnte nicht jeder Tag mit fünf Personen besetzt werden. Bitte Eingaben prüfen.' };
  const workersByDay = dates.map(() => []);
  dayEdges.forEach((edges, personIndex) => edges.forEach(({ dayIndex, edge }) => { if (edge.cap === 0) workersByDay[dayIndex].push(personIndex); }));

  const assignments = {}, roleTotals = Object.fromEntries(people.map(person => [person.id, { S: 0, T: 0, F: 0, total: 0 }]));
  let previous = {};
  for (let dayIndex = 0; dayIndex < dates.length; dayIndex++) {
    const date = dates[dayIndex], workers = workersByDay[dayIndex];
    const { dateKey, assigned } = assignRoles(workers, people, previous, roleTotals, date);
    assignments[dateKey] = assigned; previous = assigned;
  }

  const violations = [];
  const byPerson = people.map((person, index) => {
    const shifts = roleTotals[person.id].total;
    const actualHours = shifts * SHIFT_HOURS + targets[index].vacationHours;
    const balance = actualHours - targets[index].contractHours;
    const wishedOffWorked = dates.filter(date => isWish(person, date) && assignments[key(date)]?.[person.id]).map(key);
    const avoided = dates.filter(date => person.avoid.includes(assignments[key(date)]?.[person.id])).map(date => ({ date: key(date), shift: assignments[key(date)][person.id] }));
    const freeWeekends = weekendChoice.byMonth.map(weekends => weekends.filter(([sat, sun]) => !assignments[sat]?.[person.id] && !assignments[sun]?.[person.id]).length);
    const annualVacation = {};
    dates.forEach(date => {
      if (date.getUTCDay() === 0 || date.getUTCDay() === 6 || !isVacation(person, key(date))) return;
      annualVacation[date.getUTCFullYear()] = (annualVacation[date.getUTCFullYear()] || 0) + 1;
    });
    if (wishedOffWorked.length) violations.push(`${person.name}: ${wishedOffWorked.length} Freiwunsch-Tage wurden verplant.`);
    if (avoided.length) violations.push(`${person.name}: ${avoided.length} unerwünschte Diensttypen wurden vergeben.`);
    if (freeWeekends.some(count => count < 2)) violations.push(`${person.name}: weniger als zwei komplette freie Wochenenden in einem Monat.`);
    if (Number.isFinite(person.vacationWeeks) && Object.values(annualVacation).some(days => days / 5 > person.vacationWeeks + 1e-8)) violations.push(`${person.name}: Die Ferien im Planungszeitraum überschreiten die angegebenen Jahreswochen.`);
    return { id: person.id, name: person.name, percent: person.percent, shifts, contractHours: targets[index].contractHours, vacationHours: targets[index].vacationHours, actualHours, balance, wishedOffWorked, avoided, freeWeekends, annualVacation };
  });
  const coverage = true;
  const exactPensum = byPerson.every(row => Math.abs(row.balance) < 0.005);
  return {
    startMonth, dates: dates.map(key), assignments, byPerson, coverage,
    exactPensum, violations,
    requiredDuties: dates.length * 5, assignedDuties: result.flow,
    capacityHours: dates.length * 5 * SHIFT_HOURS,
    contractHours: byPerson.reduce((sum, row) => sum + row.contractHours, 0),
    vacationHours: byPerson.reduce((sum, row) => sum + row.vacationHours, 0),
  };
}
