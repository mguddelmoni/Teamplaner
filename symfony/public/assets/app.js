import { planTwoMonths } from './solver.mjs';

const defaults = [
  ['Emma Schmid', 100], ['Felix Weber', 100], ['Anna Meier', 40], ['Ben Keller', 40],
  ['Clara Roth', 40], ['David Fischer', 40], ['Eva Baumann', 60], ['Farid Huber', 60],
  ['Gina Müller', 60], ['Hugo Steiner', 60], ['Ida Graf', 60], ['Jonas Frei', 60],
];
const storageKey = 'teamplaner-v1';
const $ = selector => document.querySelector(selector);
const weekdayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const pad = number => String(number).padStart(2, '0');
const key = date => date.toISOString().slice(0, 10);
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const freshPeople = () => defaults.map(([name, percent], index) => ({ id: `person-${index + 1}`, name, percent, vacationWeeks: 5, weeklyOff: [], offDates: [], vacationRanges: [], avoid: [] }));
const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && key(parsed) === value;
};
const date = value => new Date(`${value}T00:00:00.000Z`);
const monthOf = value => value.slice(0, 7);
const nextMonth = (value, delta) => {
  const [year, month] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}`;
};
const monthDays = value => {
  const [year, month] = value.split('-').map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => new Date(Date.UTC(year, month - 1, index + 1)));
};
const isVacation = (person, value) => person.vacationRanges.some(range => value >= range.start && value <= range.end);
const isWish = (person, value) => person.offDates.includes(value) || person.weeklyOff.includes(date(value).getUTCDay());
const hours = value => {
  const minutes = Math.round(Math.abs(value) * 60);
  return `${value < -0.0001 ? '−' : value > 0.0001 ? '+' : ''}${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min`;
};
let people = freshPeople();
let startMonth = '2026-10';
let viewMonth = startMonth;
let plan = null;
let statusMessage = 'Plan erstellen, um die tägliche Besetzung und das Pensum für zwei Monate zu prüfen.';

try {
  const stored = JSON.parse(localStorage.getItem(storageKey));
  if (stored && /^\d{4}-(0[1-9]|1[0-2])$/.test(stored.month) && Array.isArray(stored.people)) {
    people = stored.people.map(person => ({
      id: String(person.id), name: String(person.name), percent: Number(person.percent),
      vacationWeeks: Number(person.vacationWeeks) || 0,
      weeklyOff: Array.isArray(person.weeklyOff) ? person.weeklyOff.filter(day => Number.isInteger(day) && day >= 0 && day <= 6) : [],
      offDates: Array.isArray(person.offDates) ? person.offDates.filter(validDate) : [],
      vacationRanges: Array.isArray(person.vacationRanges) ? person.vacationRanges.filter(range => validDate(range.start) && validDate(range.end) && range.start <= range.end) : [],
      avoid: Array.isArray(person.avoid) ? person.avoid.filter(shift => ['S', 'T', 'F'].includes(shift)) : [],
    }));
    startMonth = stored.month;
    viewMonth = startMonth;
  }
} catch { /* A private browsing mode may disable local storage. */ }

function saveLocal() {
  try { localStorage.setItem(storageKey, JSON.stringify({ month: startMonth, people })); }
  catch { $('.storage-note').textContent = 'Speichern in diesem Browser ist derzeit nicht verfügbar.'; }
}
function invalidate() {
  plan = null;
  statusMessage = 'Eingaben geändert. Bitte den Plan neu erstellen.';
  render();
  saveLocal();
}
function renderPeople() {
  $('#employee-list').innerHTML = people.map(person => `<button class="employee-item" type="button" data-id="${escapeHtml(person.id)}"><span><strong>${escapeHtml(person.name)}</strong><small>${person.vacationWeeks} Ferienwochen/Jahr</small></span><span class="badge">${person.percent}%</span></button>`).join('');
}
function renderTable() {
  const dates = monthDays(viewMonth);
  const [year, month] = viewMonth.split('-').map(Number);
  $('#plan-heading').textContent = new Intl.DateTimeFormat('de-CH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
  $('#month').value = startMonth;
  $('#plan-subtitle').textContent = plan ? `Planungszeitraum: ${plan.startMonth} bis ${nextMonth(plan.startMonth, 1)} · Ansicht: ${viewMonth}` : 'Der Plan wird für zwei Monate geprüft.';
  const head = `<thead><tr><th class="name-col">Name</th>${dates.map(day => `<th class="${[0, 6].includes(day.getUTCDay()) ? 'weekend' : ''}">${day.getUTCDate()}<small>${weekdayNames[day.getUTCDay()]}</small></th>`).join('')}<th>Dienste</th></tr></thead>`;
  const rows = people.map(person => {
    let total = 0;
    const cells = dates.map(day => {
      const value = key(day);
      const shift = plan?.assignments[value]?.[person.id] || '';
      const vacation = isVacation(person, value);
      if (shift) total++;
      const warning = shift && (isWish(person, value) || person.avoid.includes(shift));
      const label = vacation ? 'Ferien' : shift ? `${shift}-Dienst${warning ? ', Präferenz übergangen' : ''}` : isWish(person, value) ? 'frei gewünscht' : 'frei';
      const classes = [
        [0, 6].includes(day.getUTCDay()) ? 'weekend' : '',
        vacation ? 'vacation' : shift ? `shift-${shift.toLowerCase()}` : '',
        warning ? 'wish-override' : '',
      ].filter(Boolean).join(' ');
      return `<td class="${classes}" title="${escapeHtml(`${person.name}, ${value}: ${label}`)}">${vacation ? 'Ferien' : shift || (isWish(person, value) ? '·' : '')}</td>`;
    }).join('');
    return `<tr><td class="name-col">${escapeHtml(person.name)}<small>${person.percent}%</small></td>${cells}<td>${plan ? total : '–'}</td></tr>`;
  }).join('');
  const counts = dates.map(day => plan ? Object.keys(plan.assignments[key(day)] || {}).length : null);
  const foot = `<tfoot><tr><td class="name-col">Besetzung</td>${counts.map(count => `<td class="${count !== null && count !== 5 ? 'unfilled' : ''}">${count ?? '–'}</td>`).join('')}<td>${plan ? counts.reduce((sum, count) => sum + count, 0) : '–'}</td></tr></tfoot>`;
  $('#plan-table').innerHTML = head + `<tbody>${rows}</tbody>` + foot;
  $('#previous-month').disabled = Boolean(plan && viewMonth === plan.startMonth);
  $('#next-month').disabled = Boolean(plan && viewMonth === nextMonth(plan.startMonth, 1));
}
function renderSummary() {
  if (!plan) {
    $('#summary').innerHTML = '';
    $('#messages').innerHTML = `<div class="message ${statusMessage.startsWith('Mit ') || statusMessage.startsWith('Am ') || statusMessage.startsWith('Mindestens') ? 'error' : 'warn'}">${escapeHtml(statusMessage)}</div>`;
    $('#balances').innerHTML = '';
    $('#export-csv').disabled = true;
    return;
  }
  const difference = plan.contractHours - plan.vacationHours - plan.capacityHours;
  const imbalance = plan.byPerson.filter(row => Math.abs(row.balance) >= 1 / 120).length;
  $('#summary').innerHTML = `
    <div class="metric"><strong>${plan.assignedDuties}/${plan.requiredDuties}</strong><span>Dienste besetzt</span></div>
    <div class="metric"><strong>${plan.dates.length}</strong><span>Kalendertage · zwei Monate</span></div>
    <div class="metric"><strong>${imbalance}</strong><span>Personen mit Pensumsaldo</span></div>
    <div class="metric"><strong>${hours(difference)}</strong><span>Pensumsbedarf minus Dienstplätze</span></div>`;
  const messages = [];
  if (plan.coverage) messages.push(`<div class="message ok">Alle Tage sind mit genau 1 S-, 2 T- und 2 F-Diensten besetzt. Zwei komplett freie Wochenenden je Person und Monat sind eingeplant.</div>`);
  if (Math.abs(difference) > 1 / 120) messages.push(`<div class="message warn">Die vertraglichen Sollstunden abzüglich bezahlter Ferien weichen um ${hours(difference)} von den verfügbaren Dienststunden ab. Exakte Pensumerfüllung für alle ist damit rechnerisch unmöglich.</div>`);
  else if (!plan.exactPensum) messages.push(`<div class="message warn">Die Gesamtstunden passen, einzelne Pensen können wegen ganzer Dienste und weiterer Regeln trotzdem nicht exakt erreicht werden. Die Salden stehen unten.</div>`);
  if (plan.violations.length) messages.push(`<div class="message warn"><strong>Übergangene Wünsche:</strong><ul>${plan.violations.map(message => `<li>${escapeHtml(message)}</li>`).join('')}</ul></div>`);
  $('#messages').innerHTML = messages.join('');
  $('#balances').innerHTML = `<h3 id="balances-heading">Stundenbilanz für beide Monate</h3><p>Ferien an Werktagen zählen anteilig als bezahlte Sollstunden. Ein Dienst zählt 8 h 24 min.</p><div class="balance-scroll"><table class="balance-table"><thead><tr><th>Name</th><th>Pensum</th><th>Dienste</th><th>Soll</th><th>Ferien</th><th>Ist inkl. Ferien</th><th>Saldo</th><th>Freie Wochenenden</th></tr></thead><tbody>${plan.byPerson.map(row => `<tr><td>${escapeHtml(row.name)}</td><td>${row.percent}%</td><td>${row.shifts}</td><td>${hours(row.contractHours).replace('+', '')}</td><td>${hours(row.vacationHours).replace('+', '')}</td><td>${hours(row.actualHours).replace('+', '')}</td><td class="${Math.abs(row.balance) < 1 / 120 ? 'balance-ok' : 'balance-warn'}">${hours(row.balance)}</td><td>${row.freeWeekends.join(' / ')}</td></tr>`).join('')}</tbody></table></div>`;
  $('#export-csv').disabled = false;
}
function render() { renderPeople(); renderTable(); renderSummary(); }

function openDialog(person = null) {
  const dialog = $('#person-dialog');
  dialog.dataset.id = person?.id || '';
  $('#dialog-title').textContent = person ? 'Person bearbeiten' : 'Person hinzufügen';
  $('#person-name').value = person?.name || '';
  $('#person-percent').value = person?.percent ?? 60;
  $('#person-vacation-weeks').value = person?.vacationWeeks ?? 5;
  $('#person-off-dates').value = person?.offDates.join(', ') || '';
  $('#person-vacation-ranges').value = person?.vacationRanges.map(range => `${range.start} / ${range.end}`).join('\n') || '';
  $('#weekly-off').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(day => `<label><input type="checkbox" name="weekly-off" value="${day}" ${person?.weeklyOff.includes(day) ? 'checked' : ''}> ${weekdayNames[day]}</label>`).join('');
  document.querySelectorAll('input[name="avoid"]').forEach(input => { input.checked = Boolean(person?.avoid.includes(input.value)); });
  $('#delete-person').hidden = !person;
  $('#form-error').textContent = '';
  dialog.showModal();
  $('#person-name').focus();
}
function parseDates(text) {
  const values = text.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean);
  if (values.some(value => !validDate(value))) throw new Error('Bitte Datumswünsche im Format JJJJ-MM-TT eingeben.');
  return [...new Set(values)].sort();
}
function parseRanges(text) {
  if (!text.trim()) return [];
  return text.trim().split(/\n+/).map(line => {
    const match = line.trim().match(/^(\d{4}-\d{2}-\d{2})\s*\/\s*(\d{4}-\d{2}-\d{2})$/);
    if (!match || !validDate(match[1]) || !validDate(match[2]) || match[1] > match[2]) throw new Error('Ferien bitte je Zeile als JJJJ-MM-TT / JJJJ-MM-TT eingeben.');
    return { start: match[1], end: match[2] };
  });
}
$('#add-person').addEventListener('click', () => openDialog());
$('#employee-list').addEventListener('click', event => {
  const item = event.target.closest('[data-id]');
  if (item) openDialog(people.find(person => person.id === item.dataset.id));
});
$('#close-dialog').addEventListener('click', () => $('#person-dialog').close());
$('#person-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const name = $('#person-name').value.trim();
    const percent = Number($('#person-percent').value);
    const vacationWeeks = Number($('#person-vacation-weeks').value);
    if (!name) throw new Error('Bitte einen Namen eingeben.');
    if (!Number.isInteger(percent) || percent < 10 || percent > 100) throw new Error('Das Pensum muss zwischen 10 und 100 % in ganzen Schritten liegen.');
    if (!Number.isFinite(vacationWeeks) || vacationWeeks < 0 || vacationWeeks > 12 || vacationWeeks * 2 % 1 !== 0) throw new Error('Ferienwochen müssen zwischen 0 und 12 in halben Wochen liegen.');
    const id = $('#person-dialog').dataset.id || `person-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
    const person = {
      id, name, percent, vacationWeeks,
      weeklyOff: [...document.querySelectorAll('input[name="weekly-off"]:checked')].map(input => Number(input.value)),
      offDates: parseDates($('#person-off-dates').value),
      vacationRanges: parseRanges($('#person-vacation-ranges').value),
      avoid: [...document.querySelectorAll('input[name="avoid"]:checked')].map(input => input.value),
    };
    const index = people.findIndex(item => item.id === id);
    if (index < 0) people.push(person); else people[index] = person;
    $('#person-dialog').close();
    invalidate();
  } catch (error) { $('#form-error').textContent = error.message; }
});
$('#delete-person').addEventListener('click', () => {
  const id = $('#person-dialog').dataset.id;
  people = people.filter(person => person.id !== id);
  $('#person-dialog').close();
  invalidate();
});
$('#month').addEventListener('change', event => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) return;
  startMonth = viewMonth = event.target.value;
  invalidate();
});
$('#previous-month').addEventListener('click', () => { viewMonth = nextMonth(viewMonth, -1); renderTable(); });
$('#next-month').addEventListener('click', () => { viewMonth = nextMonth(viewMonth, 1); renderTable(); });
$('#generate').addEventListener('click', () => {
  const button = $('#generate');
  button.disabled = true;
  button.textContent = 'Plane …';
  setTimeout(() => {
    try {
      const result = planTwoMonths(startMonth, people);
      if (result.error) { plan = null; statusMessage = result.error; }
      else { plan = result; viewMonth = startMonth; }
      render();
    } catch { plan = null; statusMessage = 'Der Plan konnte nicht erstellt werden. Bitte Eingaben prüfen und erneut versuchen.'; render(); }
    finally { button.disabled = false; button.textContent = 'Plan für zwei Monate erstellen'; }
  }, 0);
});
$('#print-plan').addEventListener('click', () => window.print());
$('#export-csv').addEventListener('click', () => {
  if (!plan) return;
  const csvCell = value => `"${String(value).replaceAll('"', '""')}"`;
  const lines = [['Datum', 'Wochentag', 'S', 'T1', 'T2', 'F1', 'F2'].map(csvCell).join(';')];
  for (const day of plan.dates) {
    const assignment = plan.assignments[day];
    const names = shift => people.filter(person => assignment[person.id] === shift).map(person => person.name);
    lines.push([day, weekdayNames[date(day).getUTCDay()], ...names('S'), ...names('T'), ...names('F')].map(csvCell).join(';'));
  }
  const blob = new Blob(['\ufeff', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `teamplaner-${plan.startMonth}-${nextMonth(plan.startMonth, 1)}.csv`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
render();
