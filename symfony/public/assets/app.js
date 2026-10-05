import { DEFAULT_SHIFT_TYPES, DEFAULT_STAFFING, DEFAULT_WORK_MODEL, dailyRequirement, staffingStatus, planTwoMonths, summarizeAssignments } from './solver.mjs';

const $ = selector => document.querySelector(selector);
const canEdit = document.body.dataset.canEdit === 'true';
const canWrite = document.body.dataset.canWrite === 'true';
const tenantSlug = document.body.dataset.tenantSlug || 'legacy';
const monthStorageKey = tenantSlug === 'legacy' ? 'teamplaner-view-month' : `teamplaner-view-month-${tenantSlug}`;
const sidebarStorageKey = `plandito-sidebar-collapsed-${tenantSlug}`;
const ownPersonId = document.body.dataset.personId || null;
const csrf = $('meta[name="csrf-token"]').content;
const weekdayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const pad = number => String(number).padStart(2, '0');
const key = date => date.toISOString().slice(0, 10);
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const date = value => new Date(`${value}T00:00:00.000Z`);
const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = date(value);
  return Number.isFinite(parsed.getTime()) && key(parsed) === value;
};
const nextMonth = (value, delta) => {
  const [year, month] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}`;
};
const monthDays = value => {
  const [year, month] = value.split('-').map(Number);
  return Array.from({ length: new Date(Date.UTC(year, month, 0)).getUTCDate() }, (_, i) => new Date(Date.UTC(year, month - 1, i + 1)));
};
const isVacation = (person, value) => person.vacationRanges.some(range => value >= range.start && value <= range.end);
const isWish = (person, value) => person.offDates.includes(value) || person.weeklyOff.includes(date(value).getUTCDay());
const hours = value => {
  const minutes = Math.round(Math.abs(value) * 60);
  return `${value < -0.0001 ? '−' : value > 0.0001 ? '+' : ''}${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min`;
};
const shiftLabel = value => value ? `${value} (${shiftTypes.find(type => type.code === value)?.name || 'Dienst'})` : 'frei';
const shiftDuration = minutes => `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min`;
const unitsLabel = value => String(value).replace('.', ',');
const keyLabel = codes => codes.join(', ');
const workloadLabel = person => person.weeklyHours == null ? `${person.percent}%` : `${unitsLabel(person.weeklyHours)} h/Woche`;
const shiftColor = type => /^#[0-9a-f]{6}$/i.test(type?.color || '') ? type.color : ({ F: '#e1efd2', T: '#dceafa', S: '#ffe8cf' }[type?.code] || '#ece4f7');
const shiftInk = type => {
  const rgb = shiftColor(type).slice(1).match(/../g).map(part => parseInt(part, 16));
  return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 145 ? '#17324d' : '#ffffff';
};
const shiftStyle = type => `--shift-color:${shiftColor(type)};--shift-ink:${shiftInk(type)}`;
const personName = id => people.find(person => person.id === id)?.name || id;
let people = [];
let shiftTypes = DEFAULT_SHIFT_TYPES;
let staffing = DEFAULT_STAFFING;
let workModel = DEFAULT_WORK_MODEL;
let startMonth = '2026-10';
let viewMonth = startMonth;
let plan = null;
let assignments = null;
let revision = 0;
let requests = [];
let accounts = [];
let ready = false;
let statusMessage = 'Gemeinsamen Plan laden …';
let selectedSwap = null;
let activeCell = null;
let sidebarCollapsed = localStorage.getItem(sidebarStorageKey) === '1';
function renderSidebar() {
  $('#page-layout').classList.toggle('sidebar-collapsed', sidebarCollapsed);
  $('#planning-sidebar').hidden = sidebarCollapsed;
  $('#toggle-sidebar').textContent = sidebarCollapsed ? 'Einstellungen einblenden' : 'Einstellungen ausblenden';
  $('#toggle-sidebar').setAttribute('aria-expanded', String(!sidebarCollapsed));
}
const monthSaved = month => Boolean(assignments && monthDays(month).every(day => Object.hasOwn(assignments, key(day))));
const futureMonth = month => {
  const today = new Date();
  return month > `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
};
const summaryStart = () => monthSaved(nextMonth(viewMonth, -1)) ? nextMonth(viewMonth, -1) : viewMonth;
function selectMonth(month) {
  viewMonth = month;
  localStorage.setItem(monthStorageKey, month);
  plan = monthSaved(viewMonth) ? summarizeAssignments(summaryStart(), people, assignments, shiftTypes, staffing, workModel) : null;
  render();
}

async function api(method, path, body) {
  const response = await fetch(path, {
    method, credentials: 'same-origin',
    headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.redirected && new URL(response.url).pathname === '/login') {
    location.href = '/login';
    throw new Error('Bitte erneut anmelden.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Die Änderung konnte nicht gespeichert werden.');
  return result;
}
function applySnapshot(snapshot, keepView = true) {
  revision = snapshot.revision;
  people = snapshot.people;
  shiftTypes = snapshot.shiftTypes || DEFAULT_SHIFT_TYPES;
  staffing = snapshot.staffing || DEFAULT_STAFFING;
  workModel = snapshot.workModel || DEFAULT_WORK_MODEL;
  startMonth = snapshot.month;
  assignments = snapshot.assignments;
  requests = snapshot.requests || [];
  const storedView = localStorage.getItem(monthStorageKey);
  viewMonth = keepView ? viewMonth : /^\d{4}-(0[1-9]|1[0-2])$/.test(storedView || '') ? storedView : startMonth;
  plan = monthSaved(viewMonth) ? summarizeAssignments(summaryStart(), people, assignments, shiftTypes, staffing, workModel) : null;
  ready = true;
  statusMessage = monthSaved(viewMonth) ? '' : 'Dieser Monat ist noch nicht geplant. Ein vorhandener Vormonat wird beim Planen berücksichtigt.';
  render();
}
async function refresh() {
  const snapshot = await api('GET', '/api/state');
  applySnapshot(snapshot);
  if (canEdit) await refreshAccounts();
}
async function refreshAccounts() {
  accounts = (await api('GET', '/api/accounts')).accounts;
  renderPeople();
}
async function saveState(nextPeople, nextMonth = viewMonth, nextAssignments = assignments, nextShiftTypes = shiftTypes, nextStaffing = staffing, nextWorkModel = workModel) {
  const snapshot = await api('PUT', '/api/state', { revision, month: nextMonth, people: nextPeople, shiftTypes: nextShiftTypes, staffing: nextStaffing, workModel: nextWorkModel, assignments: nextAssignments });
  applySnapshot(snapshot);
}
function message(text, kind = 'error') {
  $('#action-message').textContent = text;
  $('#action-message').className = `message ${kind}`;
  $('#action-message').hidden = false;
}
function clearMessage() { $('#action-message').hidden = true; }
function renderPeople() {
  $('#employee-list').innerHTML = people.map(person => canEdit
    ? `<button class="employee-item" type="button" data-id="${escapeHtml(person.id)}"><span><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(accounts.find(item => item.personId === person.id)?.username || 'Login fehlt')} · ${person.vacationWeeks} Ferienwochen/Jahr</small></span><span class="badge">${escapeHtml(workloadLabel(person))}</span></button>`
    : `<div class="employee-item ${person.id === ownPersonId ? 'own-person' : ''}"><span><strong>${escapeHtml(person.name)}</strong><small>${person.id === ownPersonId ? 'Dein Login · ' : ''}${person.vacationWeeks} Ferienwochen/Jahr</small></span><span class="badge">${escapeHtml(workloadLabel(person))}</span></div>`).join('');
}
function renderShiftTypes() {
  $('#add-shift').hidden = !canEdit;
  $('#shift-list').innerHTML = shiftTypes.map(type => {
    const detail = `${shiftDuration(type.minutes)} · ${unitsLabel(type.staffingUnits ?? 0.5)} Tagespensum · ${type.coverage ? `${type.weight === 0.5 ? '½' : '1'} ${type.coverage}` : 'eigener Dienst'}`;
    const timing = type.startTime ? ` · ${type.startTime}–${type.endTime}${type.endTime <= type.startTime ? ' (+1 Tag)' : ''}` : '';
    const content = `<strong class="shift-swatch" style="${shiftStyle(type)}">${escapeHtml(type.code)}</strong><span>${escapeHtml(type.name)}</span><small>${escapeHtml(detail + timing)}</small>`;
    return canEdit ? `<button type="button" class="shift-item" data-code="${escapeHtml(type.code)}">${content}</button>` : `<div class="shift-item">${content}</div>`;
  }).join('');
  $('#shift-legend').innerHTML = shiftTypes.map(type => `<span><i class="chip shift-swatch" style="${shiftStyle(type)}"></i> ${escapeHtml(type.code)} ${escapeHtml(type.name)} · ${escapeHtml(shiftDuration(type.minutes))}</span>`).join('') + '<span><i class="chip chip-v"></i> Ferien</span><span>Leeres Feld: frei</span><span><i class="chip chip-shortage"></i> Rot: Tagesvorgabe fehlt</span>';
}
function renderStaffing() {
  $('#edit-staffing').hidden = !canEdit;
  $('#staffing-summary').textContent = `Standard: ${unitsLabel(staffing.defaultTarget)} · ${keyLabel(staffing.defaultKey) || 'kein Dienst'}`;
  $('#weekly-summary').textContent = [1, 2, 3, 4, 5, 6, 0].filter(day => staffing.week?.[day]).map(day => `${weekdayNames[day]}: ${staffing.week[day].target === 0 && !staffing.week[day].key.length ? 'geschlossen' : unitsLabel(staffing.week[day].target)}`).join(' · ');
  $('#edit-work-model').hidden = !canEdit;
  $('#work-model-summary').textContent = `${unitsLabel(workModel.weeklyHours)} h/Woche · Sollzeit ${workModel.workdays.map(day => weekdayNames[day]).join(', ')} · ${workModel.holidays.length} ${workModel.holidays.length === 1 ? 'Feiertag' : 'Feiertage'}`;
  $('#rule-weekly-hours').textContent = `${unitsLabel(workModel.weeklyHours)} h`;
}
function renderTable() {
  const dates = monthDays(viewMonth);
  const [year, month] = viewMonth.split('-').map(Number);
  const saved = monthSaved(viewMonth);
  const statuses = dates.map(day => staffingStatus(assignments?.[key(day)], dailyRequirement(staffing, key(day)), shiftTypes));
  const shortages = dates.map((day, index) => monthSaved(viewMonth) && !statuses[index].complete);
  $('#plan-heading').textContent = new Intl.DateTimeFormat('de-CH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
  $('#month').value = viewMonth;
  $('#plan-subtitle').textContent = saved ? `Monat ${viewMonth} gespeichert · Vergleich mit ${summaryStart()} bis ${nextMonth(summaryStart(), 1)}` : `Monat ${viewMonth} noch nicht geplant`;
  const head = `<thead><tr><th class="name-col">Name</th>${dates.map((day, index) => `<th class="${[0, 6].includes(day.getUTCDay()) ? 'weekend' : ''} ${shortages[index] ? 'day-shortage' : ''}" title="${escapeHtml(`Soll ${unitsLabel(statuses[index].target)} · ${keyLabel(dailyRequirement(staffing, key(day)).key)}${statuses[index].missing.length ? ` · fehlend: ${statuses[index].missing.join(', ')}` : ''}`)}">${day.getUTCDate()}<small>${weekdayNames[day.getUTCDay()]}</small></th>`).join('')}<th>Dienste</th></tr></thead>`;
  const rows = people.map(person => {
    let total = 0;
    const cells = dates.map((day, index) => {
      const value = key(day);
      const shift = assignments?.[value]?.[person.id] || '';
      const vacation = isVacation(person, value);
      if (shift) total++;
      const warning = shift && (isWish(person, value) || person.avoid.includes(shift));
      const label = vacation ? 'Ferien' : shift ? `${shiftLabel(shift)}${warning ? ', Präferenz übergangen' : ''}` : isWish(person, value) ? 'frei gewünscht' : 'frei';
      const interactive = canWrite && saved && !vacation && (canEdit || person.id === ownPersonId);
      const classes = [
        [0, 6].includes(day.getUTCDay()) ? 'weekend' : '',
        vacation ? 'vacation' : shift ? 'shift-custom' : '',
        warning ? 'wish-override' : '',
        shortages[index] ? 'day-shortage' : '',
        interactive ? 'swap-cell' : '',
      ].filter(Boolean).join(' ');
      const attributes = interactive ? `data-date="${value}" data-person="${escapeHtml(person.id)}" ${canEdit ? 'draggable="true"' : ''} tabindex="0" role="button" aria-label="${escapeHtml(`${person.name}, ${value}, ${label}: ${canEdit ? 'Dienst bearbeiten oder tauschen' : 'Tausch-Antrag stellen'}`)}"` : '';
      return `<td class="${classes}" ${shift && !vacation ? `style="${shiftStyle(shiftTypes.find(type => type.code === shift))}"` : ''} ${attributes} title="${escapeHtml(`${person.name}, ${value}: ${label}`)}">${vacation ? 'Ferien' : shift || (isWish(person, value) ? '·' : '')}</td>`;
    }).join('');
    return `<tr class="${person.id === ownPersonId ? 'own-row' : ''}"><td class="name-col">${escapeHtml(person.name)}<small>${escapeHtml(workloadLabel(person))}${person.id === ownPersonId ? ' · du' : ''}</small></td>${cells}<td>${saved ? total : '–'}</td></tr>`;
  }).join('');
  const foot = `<tfoot><tr><td class="name-col">Besetzung<small>${canEdit ? 'Tag anklicken' : 'Tagespensum'}</small></td>${dates.map((day, index) => {
    const dayKey = key(day), status = statuses[index];
    const attributes = canEdit ? `data-staffing-day="${dayKey}" tabindex="0" role="button" aria-label="Tagesbesetzung für ${dayKey} ändern"` : '';
    return `<td class="${shortages[index] ? 'day-shortage' : ''} ${canEdit ? 'staffing-cell' : ''}" ${attributes} title="${escapeHtml(`Tagespensum ${unitsLabel(status.target)}${dailyRequirement(staffing, dayKey).key.length ? ` · Schlüssel: ${keyLabel(dailyRequirement(staffing, dayKey).key)}` : ''}`)}">${unitsLabel(status.target)}</td>`;
  }).join('')}<td>${unitsLabel(statuses.reduce((sum, status) => sum + status.target, 0))}</td></tr></tfoot>`;
  $('#plan-table').innerHTML = head + `<tbody>${rows}</tbody>` + foot;
  $('#previous-month').disabled = false;
  $('#next-month').disabled = false;
}
function renderSummary() {
  if (!plan) {
    $('#summary').innerHTML = '';
    $('#messages').innerHTML = `<div class="message warn">${escapeHtml(statusMessage)}</div>`;
    $('#balances').innerHTML = '';
    $('#export-csv').disabled = true;
    return;
  }
  const difference = plan.contractHours - plan.vacationHours - plan.capacityHours;
  const imbalance = plan.byPerson.filter(row => Math.abs(row.balance) >= 1 / 120).length;
  const weekendDeficit = row => row.freeWeekends.some(count => count < 2) || row.freeWeekends.reduce((sum, count) => sum + count, 0) < 4;
  const weekendShortfalls = plan.byPerson.filter(weekendDeficit).length;
  $('#summary').innerHTML = `
    <div class="metric"><strong>${unitsLabel(plan.assignedDuties)}/${unitsLabel(plan.requiredDuties)}</strong><span>Tagespensum besetzt</span></div>
    <div class="metric"><strong>${plan.dates.length}</strong><span>Kalendertage · zwei Monate</span></div>
    <div class="metric"><strong>${imbalance}</strong><span>Personen mit Pensumsaldo</span></div>
    <div class="metric"><strong>${hours(difference)}</strong><span>Sollstunden minus geplante Stunden</span></div>`;
  const messages = [];
  if (plan.coverage) messages.push(`<div class="message ok">Alle Tage erfüllen ihr Tagespensum und ihren Dienstschlüssel.</div>`);
  else messages.push(`<div class="message error">${plan.shortageDays} Tage erfüllen das Tagespensum oder den Dienstschlüssel noch nicht. Fehlende Besetzungseinheiten: ${unitsLabel(plan.requiredDuties - plan.assignedDuties)}. Diese Tage sind im Kalender rot markiert.</div>`);
  if (weekendShortfalls) messages.push(`<div class="message error">${weekendShortfalls} ${weekendShortfalls === 1 ? 'Person hat' : 'Personen haben'} weniger als zwei komplett freie Wochenenden in einem Monat oder weniger als vier in zwei Monaten. Die Stundenbilanz markiert sie rot.</div>`);
  if (Math.abs(difference) > 1 / 120) messages.push(`<div class="message warn">Die vertraglichen Sollstunden abzüglich bezahlter Ferien weichen um ${hours(difference)} von den tatsächlich geplanten Dienststunden ab. Exakte Pensumerfüllung für alle ist damit derzeit nicht erreicht.</div>`);
  else if (!plan.exactPensum) messages.push(`<div class="message warn">Die Gesamtstunden passen, einzelne Pensen können wegen ganzer Dienste und weiterer Regeln trotzdem nicht exakt erreicht werden. Die Salden stehen unten.</div>`);
  const otherViolations = plan.violations.filter(item => !item.includes('weniger als zwei komplette freie Wochenenden'));
  if (otherViolations.length) messages.push(`<div class="message warn"><strong>Weitere Hinweise:</strong><ul>${otherViolations.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`);
  $('#messages').innerHTML = messages.join('');
  $('#balances').innerHTML = `<h3 id="balances-heading">Stundenbilanz für beide Monate</h3><p>Ferien an den Solltagen des Arbeitszeitmodells zählen als bezahlte Sollstunden; Feiertage sind ausgenommen. Jeder Dienst zählt mit seiner eingestellten Dauer. Freie Wochenenden stehen für Monat 1 / Monat 2.</p><div class="balance-scroll"><table class="balance-table"><thead><tr><th>Name</th><th>Pensum</th><th>Dienste</th><th>Soll</th><th>Ferien</th><th>Ist inkl. Ferien</th><th>Saldo</th><th>Freie Wochenenden</th></tr></thead><tbody>${plan.byPerson.map(row => `<tr class="${weekendDeficit(row) ? 'weekend-deficit' : ''}"><td>${escapeHtml(row.name)}</td><td>${escapeHtml(workloadLabel(row))}</td><td>${row.shifts}</td><td>${hours(row.contractHours).replace('+', '')}</td><td>${hours(row.vacationHours).replace('+', '')}</td><td>${hours(row.actualHours).replace('+', '')}</td><td class="${Math.abs(row.balance) < 1 / 120 ? 'balance-ok' : 'balance-warn'}">${hours(row.balance)}</td><td class="weekend-count">${row.freeWeekends.join(' / ')}</td></tr>`).join('')}</tbody></table></div>`;
  $('#export-csv').disabled = false;
}
function renderRequests() {
  const pending = requests.filter(item => item.status === 'pending');
  $('#request-count').textContent = `${pending.length} offen`;
  if (!requests.length) {
    $('#request-list').innerHTML = '<p class="empty-requests">Noch keine Tausch-Anträge.</p>';
    return;
  }
  $('#request-list').innerHTML = requests.map(item => {
    const status = {pending:'Offen',approved:'Genehmigt',rejected:'Abgelehnt',superseded:'Durch Planänderung überholt'}[item.status] || item.status;
    const buttons = canEdit && item.status === 'pending' ? `<div class="request-actions"><button type="button" class="primary" data-decision="approve" data-id="${item.id}">Genehmigen</button><button type="button" class="secondary" data-decision="reject" data-id="${item.id}">Ablehnen</button></div>` : '';
    return `<article class="request-item"><div><strong>${escapeHtml(item.date)} · ${escapeHtml(personName(item.personId))} ↔ ${escapeHtml(personName(item.replacementId))}</strong><p>${escapeHtml(shiftLabel(item.personShift))} ↔ ${escapeHtml(shiftLabel(item.replacementShift))} · Absprache bestätigt · von ${escapeHtml(item.createdBy)}</p></div><span class="request-status status-${escapeHtml(item.status)}">${escapeHtml(status)}</span>${buttons}</article>`;
  }).join('');
}
function render() {
  $('#add-person').hidden = !canEdit;
  $('#generate').hidden = !canEdit;
  const currentSaved = monthSaved(viewMonth);
  const nextSaved = monthSaved(nextMonth(viewMonth, 1));
  const canReplan = currentSaved && futureMonth(viewMonth);
  $('#generate').disabled = !ready || (currentSaved && nextSaved && !canReplan);
  $('#generate').textContent = canReplan ? 'Erneut planen' : currentSaved && nextSaved ? 'Monate bereits geplant' : currentSaved ? 'Folgemonat planen' : monthSaved(nextMonth(viewMonth, -1)) ? 'Monat mit Vormonat planen' : 'Plan für zwei Monate erstellen';
  renderPeople(); renderShiftTypes(); renderStaffing(); renderTable(); renderSummary(); renderRequests();
}
function openPersonDialog(person = null) {
  if (!canEdit) return;
  const dialog = $('#person-dialog');
  dialog.dataset.id = person?.id || '';
  $('#dialog-title').textContent = person ? 'Person bearbeiten' : 'Person hinzufügen';
  $('#person-name').value = person?.name || '';
  $('#person-percent').value = person?.percent ?? 60;
  $('#person-weekly-hours').value = person?.weeklyHours ?? '';
  $('#person-percent').disabled = person?.weeklyHours != null;
  $('#person-vacation-weeks').value = person?.vacationWeeks ?? 5;
  $('#person-off-dates').value = person?.offDates.join(', ') || '';
  $('#person-vacation-ranges').value = person?.vacationRanges.map(range => `${range.start} / ${range.end}`).join('\n') || '';
  $('#weekly-off').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(day => `<label><input type="checkbox" name="weekly-off" value="${day}" ${person?.weeklyOff.includes(day) ? 'checked' : ''}> ${weekdayNames[day]}</label>`).join('');
  $('#avoid-shifts').innerHTML = shiftTypes.map(type => `<label><input type="checkbox" name="avoid" value="${escapeHtml(type.code)}" ${person?.avoid.includes(type.code) ? 'checked' : ''}> ${escapeHtml(type.code)}</label>`).join('');
  $('#delete-person').hidden = !person;
  $('#form-error').textContent = '';
  const account = accounts.find(item => item.personId === person?.id);
  $('#account-fields').hidden = !person;
  $('#account-username').value = account?.username || '';
  $('#account-password').value = '';
  // Das Login wird nach dem Speichern der Person eingerichtet. Ein verborgenes
  // Pflichtfeld würde die Personenerfassung schon vor dem Submit blockieren.
  $('#account-password').required = false;
  $('#account-status').textContent = account ? `Aktueller Login: ${account.username}` : 'Für diese Person ist noch kein Login eingerichtet.';
  $('#account-error').textContent = '';
  dialog.showModal();
  $('#person-name').focus();
}
function openShiftDialog(type = null) {
  if (!canEdit) return;
  $('#shift-dialog').dataset.code = type?.code || '';
  $('#shift-dialog-title').textContent = type ? 'Diensttyp bearbeiten' : 'Diensttyp hinzufügen';
  $('#shift-code').value = type?.code || '';
  $('#shift-code').readOnly = Boolean(type);
  $('#shift-name').value = type?.name || '';
  $('#shift-minutes').value = type?.minutes ?? 240;
  $('#shift-start').value = type?.startTime || '';
  $('#shift-end').value = type?.endTime || '';
  $('#shift-break').value = type?.breakMinutes || 0;
  $('#shift-color').value = shiftColor(type);
  $('#shift-coverage').innerHTML = '<option value="">Nur diesen Dienst abdecken</option>' + shiftTypes.map(item => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.code)} · ${escapeHtml(item.name)}</option>`).join('');
  $('#shift-coverage').value = type?.coverage || '';
  $('#shift-weight').value = String(type?.weight ?? 0);
  $('#shift-weight').disabled = !type?.coverage;
  $('#shift-staffing-units').value = String(type?.staffingUnits ?? 1);
  $('#delete-shift-type').hidden = !type;
  updateShiftDuration();
  $('#shift-error').textContent = '';
  $('#shift-dialog').showModal();
  $('#shift-name').focus();
}
function parseRequirement(targetValue, keyValue) {
  const target = Number(targetValue);
  const key = keyValue.split(/[\s,;]+/).map(code => code.trim().toUpperCase()).filter(Boolean);
  if (!Number.isFinite(target) || target < 0 || target > 30 || target * 2 % 1 !== 0) throw new Error('Tagespensum: 0 bis 30 in halben Schritten.');
  if (key.length > 30 || key.some(code => !shiftTypes.some(type => type.code === code))) throw new Error('Der Dienstschlüssel enthält einen unbekannten oder zu viele Dienste.');
  const keyUnits = key.reduce((sum, code) => sum + (shiftTypes.find(type => type.code === code)?.staffingUnits ?? 0.5), 0);
  if (keyUnits > target) throw new Error('Das Tagespensum muss mindestens so hoch wie der Dienstschlüssel sein.');
  return { target, key };
}
function openStaffingDialog() {
  if (!canEdit) return;
  $('#staffing-target').value = staffing.defaultTarget;
  $('#staffing-key').value = keyLabel(staffing.defaultKey);
  $('#weekly-staffing').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(day => {
    const rule = staffing.week?.[day];
    return `<div class="weekly-rule" data-weekday="${day}"><strong>${weekdayNames[day]}</strong><label><span class="sr-only">${weekdayNames[day]} Vorgabe</span><select class="week-mode"><option value="default" ${!rule ? 'selected' : ''}>Standard</option><option value="custom" ${rule ? 'selected' : ''}>Eigene Vorgabe</option></select></label><label><span class="week-field-title">Tagespensum</span><input aria-label="${weekdayNames[day]} Tagespensum" class="week-target" type="number" min="0" max="30" step="0.5" value="${rule?.target ?? staffing.defaultTarget}" ${!rule ? 'disabled' : ''} required></label><label><span class="week-field-title">Dienstschlüssel</span><input aria-label="${weekdayNames[day]} Dienstschlüssel" class="week-key" type="text" value="${escapeHtml(keyLabel(rule?.key ?? staffing.defaultKey))}" ${!rule ? 'disabled' : ''}></label></div>`;
  }).join('');
  $('#staffing-error').textContent = '';
  $('#staffing-dialog').showModal();
}
function updateWeekDefaults() {
  for (const row of document.querySelectorAll('.weekly-rule')) {
    if (row.querySelector('.week-mode').value !== 'default') continue;
    row.querySelector('.week-target').value = $('#staffing-target').value;
    row.querySelector('.week-key').value = $('#staffing-key').value;
  }
}
function openDayStaffingDialog(day) {
  if (!canEdit) return;
  const requirement = dailyRequirement(staffing, day);
  $('#day-staffing-dialog').dataset.date = day;
  $('#day-staffing-date').textContent = `${day} · ${Object.hasOwn(staffing.overrides, day) ? 'Tagesausnahme' : staffing.week?.[date(day).getUTCDay()] ? 'Wochenmuster' : 'Standard'}`;
  $('#day-staffing-target').value = requirement.target;
  $('#day-staffing-key').value = keyLabel(requirement.key);
  $('#day-staffing-error').textContent = '';
  $('#reset-day-staffing').hidden = !Object.hasOwn(staffing.overrides, day);
  $('#day-staffing-dialog').showModal();
}
function updateShiftDuration() {
  const start = $('#shift-start').value, end = $('#shift-end').value;
  $('#shift-minutes').readOnly = Boolean(start && end);
  if (start && end) {
    const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const span = (minutes(end) - minutes(start) + 1440) % 1440 || 1440;
    $('#shift-minutes').value = span - Number($('#shift-break').value);
  }
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
function openSwapDialog(day, personId, replacementId = null) {
  if (!canWrite) return;
  if (!canEdit && personId !== ownPersonId) return;
  if (!assignments?.[day]) return;
  const person = people.find(item => item.id === personId);
  if (!person || isVacation(person, day)) return;
  const current = assignments[day][personId] || null;
  const candidates = people.filter(item => item.id !== personId && !isVacation(item, day) && (assignments[day][item.id] || null) !== current);
  const assignable = shiftTypes;
  if (!candidates.length && !(canEdit && (current || assignable.length))) { message('Für diesen Tag gibt es keine passende Tauschperson.'); return; }
  if (replacementId && !candidates.some(item => item.id === replacementId)) {
    message('Diese beiden Personen haben am selben Tag denselben Dienststatus oder die Ersatzperson ist in den Ferien.');
    return;
  }
  selectedSwap = { date: day, personId };
  $('#swap-title').textContent = canEdit ? 'Dienst bearbeiten oder tauschen' : 'Tausch-Antrag stellen';
  $('#swap-context').textContent = `${person.name} · ${day} · aktuell ${shiftLabel(current)}`;
  $('#swap-replacement').innerHTML = candidates.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${shiftLabel(assignments[day][item.id] || null)}</option>`).join('');
  if (replacementId && candidates.some(item => item.id === replacementId)) $('#swap-replacement').value = replacementId;
  $('#swap-agreed').checked = false;
  $('#swap-error').textContent = '';
  $('#swap-replacement-label').hidden = !candidates.length;
  $('#swap-result').hidden = !candidates.length;
  $('#swap-request').hidden = !candidates.length;
  $('#swap-direct').hidden = !canEdit || !candidates.length;
  $('#assignment-actions').hidden = !canEdit;
  $('#delete-shift').hidden = !canEdit || !current;
  $('#assign-role-label').hidden = !canEdit || !assignable.length;
  $('#assign-direct').hidden = !canEdit || !assignable.length;
  $('#assign-role-text').textContent = current ? 'Dienst ändern' : 'Dienst zuweisen';
  $('#assign-role').innerHTML = assignable.map(type => `<option value="${escapeHtml(type.code)}">${escapeHtml(type.code)} · ${escapeHtml(type.name)} · ${escapeHtml(shiftDuration(type.minutes))}</option>`).join('');
  if (current && assignable.some(type => type.code === current)) $('#assign-role').value = current;
  $('#swap-agreed').hidden = !candidates.length;
  updateSwapResult();
  $('#swap-dialog').showModal();
}
function updateSwapResult() {
  if (!selectedSwap) return;
  const other = $('#swap-replacement').value;
  const { date: day, personId } = selectedSwap;
  const oldA = assignments[day][personId] || null;
  const oldB = assignments[day][other] || null;
  $('#swap-result').textContent = `${personName(personId)}: ${shiftLabel(oldA)} → ${shiftLabel(oldB)} · ${personName(other)}: ${shiftLabel(oldB)} → ${shiftLabel(oldA)}`;
}
async function submitSwap(direct) {
  if (!selectedSwap || !$('#swap-replacement').value) return;
  if (!$('#swap-agreed').checked) { $('#swap-error').textContent = 'Bitte die Absprache mit der Ersatzperson bestätigen.'; return; }
  const payload = { revision, ...selectedSwap, replacementId: $('#swap-replacement').value, agreed: true };
  const button = direct ? $('#swap-direct') : $('#swap-request');
  button.disabled = true;
  try {
    const snapshot = await api('POST', direct ? '/api/swaps' : '/api/swap-requests', payload);
    $('#swap-dialog').close();
    applySnapshot(snapshot);
    message(direct ? 'Tausch gespeichert.' : 'Tausch-Antrag eingereicht.', 'ok');
  } catch (error) { $('#swap-error').textContent = error.message; }
  finally { button.disabled = false; }
}
async function setAssignment(shift) {
  if (!canEdit || !selectedSwap) return;
  const previous = assignments[selectedSwap.date]?.[selectedSwap.personId] || null;
  try {
    const snapshot = await api('POST', '/api/assignments', { revision, ...selectedSwap, shift });
    $('#swap-dialog').close();
    applySnapshot(snapshot);
    message(shift ? previous ? 'Dienst geändert.' : 'Dienst zugewiesen.' : 'Dienst gelöscht. Der Tag ist bis zur Nachbesetzung rot markiert.', 'ok');
  } catch (error) { $('#swap-error').textContent = error.message; }
}
$('#add-person').addEventListener('click', () => openPersonDialog());
$('#toggle-sidebar').addEventListener('click', () => {
  sidebarCollapsed = !sidebarCollapsed;
  localStorage.setItem(sidebarStorageKey, sidebarCollapsed ? '1' : '0');
  renderSidebar();
});
$('#add-shift').addEventListener('click', () => openShiftDialog());
$('#edit-work-model').addEventListener('click', () => {
  if (!canEdit) return;
  $('#work-weekly-hours').value = workModel.weeklyHours;
  $('#work-days').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(day => `<label><input type="checkbox" value="${day}" ${workModel.workdays.includes(day) ? 'checked' : ''}> ${weekdayNames[day]}</label>`).join('');
  $('#work-holidays').value = workModel.holidays.join(', ');
  $('#work-model-error').textContent = '';
  $('#work-model-dialog').showModal();
});
$('#close-work-model').addEventListener('click', () => $('#work-model-dialog').close());
$('#work-model-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!canEdit) return;
  try {
    const weeklyHours = Number($('#work-weekly-hours').value);
    const workdays = [...document.querySelectorAll('#work-days input:checked')].map(input => Number(input.value));
    if (!Number.isFinite(weeklyHours) || weeklyHours < 0.25 || weeklyHours > 80 || weeklyHours * 4 % 1 !== 0) throw new Error('Bitte 0,25 bis 80 Wochenstunden in Viertelstunden eingeben.');
    if (!workdays.length) throw new Error('Bitte mindestens einen Wochentag für die Sollzeit wählen.');
    const holidays = parseDates($('#work-holidays').value);
    await saveState(people, viewMonth, assignments, shiftTypes, staffing, { weeklyHours, workdays, holidays });
    $('#work-model-dialog').close();
    message('Arbeitszeitmodell gespeichert. Die Stundenbilanzen wurden neu berechnet.', 'ok');
  } catch (error) { $('#work-model-error').textContent = error.message; }
});
$('#weekly-staffing').addEventListener('change', event => {
  if (!event.target.matches('.week-mode')) return;
  event.target.closest('.weekly-rule').querySelectorAll('input').forEach(input => { input.disabled = event.target.value === 'default'; });
  updateWeekDefaults();
});
for (const selector of ['#staffing-target', '#staffing-key']) $(selector).addEventListener('input', updateWeekDefaults);
$('#edit-staffing').addEventListener('click', openStaffingDialog);
$('#close-staffing').addEventListener('click', () => $('#staffing-dialog').close());
$('#close-day-staffing').addEventListener('click', () => $('#day-staffing-dialog').close());
$('#staffing-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!canEdit) return;
  try {
    const requirement = parseRequirement($('#staffing-target').value, $('#staffing-key').value);
    const week = {};
    for (const row of document.querySelectorAll('.weekly-rule')) {
      if (row.querySelector('.week-mode').value === 'custom') week[row.dataset.weekday] = parseRequirement(row.querySelector('.week-target').value, row.querySelector('.week-key').value);
    }
    await saveState(people, viewMonth, assignments, shiftTypes, { ...staffing, defaultTarget: requirement.target, defaultKey: requirement.key, week });
    $('#staffing-dialog').close();
    message('Standard und Wochenmuster gespeichert. Bestehende Dienstzuweisungen bleiben erhalten.', 'ok');
  } catch (error) { $('#staffing-error').textContent = error.message; }
});
$('#day-staffing-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!canEdit) return;
  try {
    const day = $('#day-staffing-dialog').dataset.date;
    const requirement = parseRequirement($('#day-staffing-target').value, $('#day-staffing-key').value);
    await saveState(people, viewMonth, assignments, shiftTypes, { ...staffing, overrides: { ...staffing.overrides, [day]: requirement } });
    $('#day-staffing-dialog').close();
    message(`Tagesbesetzung für ${day} gespeichert.`, 'ok');
  } catch (error) { $('#day-staffing-error').textContent = error.message; }
});
$('#reset-day-staffing').addEventListener('click', async () => {
  if (!canEdit) return;
  try {
    const day = $('#day-staffing-dialog').dataset.date;
    const overrides = { ...staffing.overrides };
    delete overrides[day];
    await saveState(people, viewMonth, assignments, shiftTypes, { ...staffing, overrides });
    $('#day-staffing-dialog').close();
    message(`Für ${day} gilt wieder das Wochenmuster beziehungsweise der Standard.`, 'ok');
  } catch (error) { $('#day-staffing-error').textContent = error.message; }
});
$('#shift-list').addEventListener('click', event => {
  const item = event.target.closest('[data-code]');
  if (item) openShiftDialog(shiftTypes.find(type => type.code === item.dataset.code));
});
$('#close-shift').addEventListener('click', () => $('#shift-dialog').close());
for (const selector of ['#shift-start', '#shift-end', '#shift-break']) $(selector).addEventListener('input', updateShiftDuration);
$('#shift-coverage').addEventListener('change', () => {
  const hasCoverage = Boolean($('#shift-coverage').value);
  $('#shift-weight').disabled = !hasCoverage;
  $('#shift-weight').value = hasCoverage ? '0.5' : '0';
});
$('#shift-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!canEdit) return;
  try {
    const code = $('#shift-code').value.trim().toUpperCase();
    const name = $('#shift-name').value.trim();
    const minutes = Number($('#shift-minutes').value);
    const coverage = $('#shift-coverage').value || null;
    const weight = coverage ? Number($('#shift-weight').value) : 0;
    const staffingUnits = Number($('#shift-staffing-units').value);
    const startTime = $('#shift-start').value || null, endTime = $('#shift-end').value || null;
    const breakMinutes = Number($('#shift-break').value);
    if (!/^[A-Z][A-Z0-9]{0,5}$/.test(code)) throw new Error('Das Kürzel benötigt 1–6 Grossbuchstaben oder Zahlen.');
    if (!name || !Number.isInteger(minutes) || minutes < 15 || minutes > 1440) throw new Error('Bitte Bezeichnung und Arbeitsdauer zwischen 15 und 1440 Minuten eingeben.');
    if (Boolean(startTime) !== Boolean(endTime)) throw new Error('Bitte Beginn und Ende gemeinsam angeben oder beide leer lassen.');
    if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || (!startTime && breakMinutes !== 0)) throw new Error('Bitte eine gültige Pause mit Beginn und Ende eingeben.');
    if (coverage && ![0.5, 1].includes(weight)) throw new Error('Bitte den Besetzungsanteil wählen.');
    if (![0, 0.5, 1].includes(staffingUnits)) throw new Error('Bitte den Anteil am Tagespensum wählen.');
    const original = $('#shift-dialog').dataset.code;
    if (!original && shiftTypes.some(type => type.code === code)) throw new Error('Dieses Kürzel gibt es bereits.');
    const next = { code, name, minutes, coverage, weight, staffingUnits, startTime, endTime, breakMinutes, color: $('#shift-color').value };
    const updated = original ? shiftTypes.map(type => type.code === original ? next : type) : [...shiftTypes, next];
    await saveState(people, viewMonth, assignments, updated);
    $('#shift-dialog').close();
    message('Diensttyp gespeichert.', 'ok');
  } catch (error) { $('#shift-error').textContent = error.message; }
});
$('#delete-shift-type').addEventListener('click', async () => {
  if (!canEdit) return;
  try {
    const code = $('#shift-dialog').dataset.code;
    if (shiftTypes.length === 1) throw new Error('Mindestens ein Diensttyp muss bestehen bleiben.');
    if (Object.values(assignments || {}).some(daily => Object.values(daily).includes(code))) throw new Error('Dieser Dienst wird in gespeicherten Plänen verwendet und kann deshalb nicht entfernt werden.');
    if ([staffing.defaultKey, ...Object.values(staffing.week || {}).map(rule => rule.key), ...Object.values(staffing.overrides).map(rule => rule.key)].some(codes => codes.includes(code))) throw new Error('Bitte diesen Dienst zuerst aus Standard, Wochenmuster und Tagesausnahmen entfernen.');
    if (shiftTypes.some(type => type.code !== code && type.coverage === code)) throw new Error('Ein anderer Dienst verwendet diesen Dienst als Ersatz. Bitte zuerst die Ersetzung anpassen.');
    if (people.some(person => person.avoid.includes(code))) throw new Error('Bitte diesen Dienst zuerst aus den Dienstpräferenzen der Mitarbeitenden entfernen.');
    await saveState(people, viewMonth, assignments, shiftTypes.filter(type => type.code !== code));
    $('#shift-dialog').close();
    message('Diensttyp entfernt.', 'ok');
  } catch (error) { $('#shift-error').textContent = error.message; }
});
$('#employee-list').addEventListener('click', event => {
  const item = event.target.closest('[data-id]');
  if (item) openPersonDialog(people.find(person => person.id === item.dataset.id));
});
$('#close-dialog').addEventListener('click', () => $('#person-dialog').close());
$('#person-weekly-hours').addEventListener('input', () => { $('#person-percent').disabled = $('#person-weekly-hours').value !== ''; });
$('#person-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!canEdit) return;
  try {
    const name = $('#person-name').value.trim();
    const percent = Number($('#person-percent').value);
    const weeklyHours = $('#person-weekly-hours').value === '' ? null : Number($('#person-weekly-hours').value);
    const vacationWeeks = Number($('#person-vacation-weeks').value);
    if (!name) throw new Error('Bitte einen Namen eingeben.');
    if (!Number.isInteger(percent) || percent < 10 || percent > 100) throw new Error('Das Pensum muss zwischen 10 und 100 % in ganzen Schritten liegen.');
    if (weeklyHours !== null && (!Number.isFinite(weeklyHours) || weeklyHours < 0.25 || weeklyHours > 80 || weeklyHours * 4 % 1 !== 0)) throw new Error('Feste Wochenstunden: 0,25 bis 80 in Viertelstunden.');
    if (!Number.isFinite(vacationWeeks) || vacationWeeks < 0 || vacationWeeks > 12 || vacationWeeks * 2 % 1 !== 0) throw new Error('Ferienwochen müssen zwischen 0 und 12 in halben Wochen liegen.');
    const isNew = !$('#person-dialog').dataset.id;
    const id = $('#person-dialog').dataset.id || `person-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
    const person = {
      id, name, percent, weeklyHours, vacationWeeks,
      weeklyOff: [...document.querySelectorAll('input[name="weekly-off"]:checked')].map(input => Number(input.value)),
      offDates: parseDates($('#person-off-dates').value), vacationRanges: parseRanges($('#person-vacation-ranges').value),
      avoid: [...document.querySelectorAll('input[name="avoid"]:checked')].map(input => input.value),
    };
    const updated = [...people];
    const index = updated.findIndex(item => item.id === id);
    if (index < 0) updated.push(person); else updated[index] = person;
    await saveState(updated);
    $('#person-dialog').close();
    await refreshAccounts();
    if (isNew) {
      openPersonDialog(person);
      $('#account-username').focus();
      message('Person gespeichert. Bitte jetzt den persönlichen Login einrichten.', 'ok');
    } else message('Team gespeichert.', 'ok');
  } catch (error) { $('#form-error').textContent = error.message; }
});
$('#save-account').addEventListener('click', async () => {
  if (!canEdit) return;
  const personId = $('#person-dialog').dataset.id;
  const username = $('#account-username').value.trim().toLowerCase();
  const password = $('#account-password').value;
  const button = $('#save-account');
  button.disabled = true;
  try {
    if (!personId) throw new Error('Bitte zuerst die Person speichern.');
    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) throw new Error('Benutzername: 3–40 Zeichen, nur Kleinbuchstaben, Zahlen, Punkt, Bindestrich oder Unterstrich.');
    if (password && password.length < 12) throw new Error('Das Passwort muss mindestens 12 Zeichen lang sein.');
    if (!password && !accounts.some(item => item.personId === personId)) throw new Error('Bitte ein Passwort für den neuen Login eingeben.');
    await api('PUT', `/api/accounts/${encodeURIComponent(personId)}`, { username, password });
    await refreshAccounts();
    $('#account-password').value = '';
    $('#account-password').required = false;
    $('#account-status').textContent = `Aktueller Login: ${username}`;
    $('#account-error').textContent = '';
    message('Persönlicher Login gespeichert.', 'ok');
  } catch (error) { $('#account-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#delete-person').addEventListener('click', async () => {
  if (!canEdit) return;
  try {
    const removedId = $('#person-dialog').dataset.id;
    const remainingAssignments = assignments && Object.fromEntries(Object.entries(assignments).map(([day, daily]) => {
      const updated = { ...daily };
      delete updated[removedId];
      return [day, updated];
    }));
    await saveState(people.filter(person => person.id !== removedId), viewMonth, remainingAssignments);
    $('#person-dialog').close();
    message('Person entfernt. Fehlende Dienste sind rot markiert.', 'ok');
  } catch (error) { $('#form-error').textContent = error.message; }
});
$('#month').addEventListener('change', async event => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) return;
  selectMonth(event.target.value);
  clearMessage();
});
$('#previous-month').addEventListener('click', () => selectMonth(nextMonth(viewMonth, -1)));
$('#next-month').addEventListener('click', () => selectMonth(nextMonth(viewMonth, 1)));
$('#refresh-plan').addEventListener('click', async () => {
  try { await refresh(); message('Plan und Tausch-Anträge aktualisiert.', 'ok'); }
  catch (error) { message(error.message); }
});
$('#generate').addEventListener('click', async () => {
  if (!canEdit || !ready) return;
  const button = $('#generate');
  button.disabled = true; button.textContent = 'Plane …';
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    const previous = nextMonth(viewMonth, -1);
    const replanning = monthSaved(viewMonth) && futureMonth(viewMonth);
    const windowStart = (replanning || !monthSaved(viewMonth)) && monthSaved(previous) ? previous : viewMonth;
    const fixed = Object.fromEntries(Object.entries(assignments || {}).filter(([day]) => !replanning || !day.startsWith(`${viewMonth}-`)));
    const result = planTwoMonths(windowStart, people, fixed, shiftTypes, staffing, workModel);
    if (result.error) throw new Error(result.error);
    await saveState(people, viewMonth, { ...(assignments || {}), ...result.assignments });
    clearMessage();
  } catch (error) { message(error.message); }
  finally { render(); }
});
$('#plan-table').addEventListener('click', event => {
  const staffingCell = event.target.closest('td.staffing-cell');
  if (staffingCell) { openDayStaffingDialog(staffingCell.dataset.staffingDay); return; }
  const cell = event.target.closest('td.swap-cell');
  if (cell) openSwapDialog(cell.dataset.date, cell.dataset.person);
});
$('#plan-table').addEventListener('keydown', event => {
  if (['Enter', ' '].includes(event.key) && event.target.matches('td.staffing-cell')) {
    event.preventDefault(); openDayStaffingDialog(event.target.dataset.staffingDay); return;
  }
  if (['Enter', ' '].includes(event.key) && event.target.matches('td.swap-cell')) {
    event.preventDefault(); openSwapDialog(event.target.dataset.date, event.target.dataset.person);
  }
});
$('#plan-table').addEventListener('dragstart', event => {
  if (!canEdit) return event.preventDefault();
  const cell = event.target.closest('td.swap-cell');
  if (!cell) return event.preventDefault();
  activeCell = { date: cell.dataset.date, personId: cell.dataset.person };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', JSON.stringify(activeCell));
  cell.classList.add('dragging');
});
$('#plan-table').addEventListener('dragend', () => {
  activeCell = null;
  document.querySelectorAll('.dragging,.drag-target').forEach(cell => cell.classList.remove('dragging', 'drag-target'));
});
$('#plan-table').addEventListener('dragover', event => {
  const cell = event.target.closest('td.swap-cell');
  if (!canEdit || !cell || !activeCell || activeCell.date !== cell.dataset.date || activeCell.personId === cell.dataset.person) return;
  const first = assignments[activeCell.date][activeCell.personId] || null;
  const second = assignments[activeCell.date][cell.dataset.person] || null;
  if (first === second) return;
  event.preventDefault();
  cell.classList.add('drag-target');
});
$('#plan-table').addEventListener('dragleave', event => event.target.closest('td.swap-cell')?.classList.remove('drag-target'));
$('#plan-table').addEventListener('drop', event => {
  event.preventDefault();
  const cell = event.target.closest('td.swap-cell');
  if (!canEdit || !cell || !activeCell) return;
  if (activeCell.date !== cell.dataset.date) { message('Dienste können nur am selben Tag getauscht werden.'); return; }
  if (activeCell.personId !== cell.dataset.person) openSwapDialog(activeCell.date, activeCell.personId, cell.dataset.person);
});
$('#close-swap').addEventListener('click', () => $('#swap-dialog').close());
$('#swap-replacement').addEventListener('change', updateSwapResult);
$('#swap-form').addEventListener('submit', event => { event.preventDefault(); submitSwap(false); });
$('#swap-direct').addEventListener('click', () => submitSwap(true));
$('#assign-direct').addEventListener('click', () => setAssignment($('#assign-role').value));
$('#delete-shift').addEventListener('click', () => setAssignment(null));
$('#request-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-decision]');
  if (!button || !canEdit) return;
  button.disabled = true;
  try {
    const snapshot = await api('POST', `/api/swap-requests/${button.dataset.id}/${button.dataset.decision}`, {});
    applySnapshot(snapshot);
    message(button.dataset.decision === 'approve' ? 'Tausch genehmigt und im Plan übernommen.' : 'Tausch-Antrag abgelehnt.', 'ok');
  } catch (error) { message(error.message); button.disabled = false; }
});
$('#print-plan').addEventListener('click', () => window.print());
$('#export-csv').addEventListener('click', () => {
  if (!plan) return;
  const csvCell = value => `"${String(value).replaceAll('"', '""')}"`;
  const days = monthDays(viewMonth).map(key);
  const lines = [['Datum', 'Wochentag', 'Ist', 'Soll', 'Dienstschlüssel', ...shiftTypes.map(type => type.code)].map(csvCell).join(';')];
  for (const day of days) {
    const assignment = assignments[day] || {};
    const names = shift => people.filter(person => assignment[person.id] === shift).map(person => person.name);
    const requirement = dailyRequirement(staffing, day);
    const status = staffingStatus(assignment, requirement, shiftTypes);
    lines.push([day, weekdayNames[date(day).getUTCDay()], unitsLabel(status.units), unitsLabel(status.target), keyLabel(requirement.key), ...shiftTypes.map(type => names(type.code).join(' / '))].map(csvCell).join(';'));
  }
  const blob = new Blob(['\ufeff', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `teamplaner-${viewMonth}.csv`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function initialize() {
  try {
    let snapshot = await api('GET', '/api/state');
    if (tenantSlug === 'legacy' && canEdit && snapshot.revision === 0 && snapshot.assignments === null) {
      try {
        const old = JSON.parse(localStorage.getItem('teamplaner-v1'));
        if (old && Array.isArray(old.people) && /^\d{4}-(0[1-9]|1[0-2])$/.test(old.month)) {
          snapshot = await api('PUT', '/api/state', { revision: 0, month: old.month, people: old.people, assignments: null });
          localStorage.removeItem('teamplaner-v1');
        }
      } catch { /* Invalid old browser data is ignored. */ }
    }
    applySnapshot(snapshot, false);
    if (canEdit) await refreshAccounts();
  } catch (error) { statusMessage = error.message; render(); message(error.message); }
}
renderSidebar();
render();
initialize();
