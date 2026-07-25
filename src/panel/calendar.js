// Pure view: renders one month grid into `container` from `state` and wires
// day clicks through `onDayClick`. All selection logic (what a click means)
// lives in panel.js — this module only knows how to draw a month and report
// which date was clicked.

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthLabel(year, month) {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function renderMonth(container, { year, month, range, pendingStart, today, onDayClick }) {
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'calendar-grid';

  for (const label of WEEKDAY_LABELS) {
    const cell = document.createElement('div');
    cell.className = 'calendar-weekday';
    cell.textContent = label;
    grid.appendChild(cell);
  }

  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  // Sunday-first week: getUTCDay() already returns 0=Sun..6=Sat directly.
  const leadingBlanks = firstOfMonth.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  for (let i = 0; i < leadingBlanks; i++) {
    grid.appendChild(document.createElement('div'));
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'calendar-day';
    cell.textContent = String(day);
    cell.dataset.date = iso;

    if (iso === today) cell.classList.add('is-today');
    if (iso === pendingStart) cell.classList.add('is-pending');
    if (range && iso >= range.from && iso <= range.to) cell.classList.add('in-range');
    if (range && iso === range.from) cell.classList.add('range-start');
    if (range && iso === range.to) cell.classList.add('range-end');

    cell.setAttribute('aria-label', iso);
    cell.addEventListener('click', () => onDayClick(iso));
    grid.appendChild(cell);
  }

  container.appendChild(grid);
}
