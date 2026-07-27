import { formatShortDate, formatTime } from '../lib/dates.js';

const $ = (id) => document.getElementById(id);

// Same two-rows/three-columns layout as the live panel (see panel.css /
// panel.js's renderWorklogRow): [key | title+due | start time] over
// [status | worklog description | logged hours]. Built with
// createElement/textContent, not innerHTML, so summary/comment text — free
// -form Jira content — never needs manual escaping, including inside the
// `title` tooltip attribute.
function renderWorklogRow(item, timeZone) {
  const row = document.createElement('div');
  row.className = 'item-row';

  const key = document.createElement('span');
  key.className = 'item-key';
  key.textContent = item.key;

  const titleCell = document.createElement('span');
  titleCell.className = 'item-title-cell';
  const summaryEl = document.createElement('span');
  summaryEl.className = 'item-summary';
  summaryEl.textContent = item.summary;
  summaryEl.title = item.summary;
  titleCell.appendChild(summaryEl);
  if (item.due) {
    const dueEl = document.createElement('span');
    dueEl.className = 'item-due';
    dueEl.textContent = formatShortDate(item.due);
    titleCell.appendChild(dueEl);
  }

  const statusEl = document.createElement('span');
  statusEl.className = `status-chip ${item.statusCategory}`;
  statusEl.textContent = item.statusName;

  const hoursEl = document.createElement('span');
  hoursEl.className = 'item-hours-value';
  hoursEl.textContent = `${item.hours.toFixed(1)}h`;

  row.append(key, titleCell);

  if (item.started) {
    const timeEl = document.createElement('span');
    timeEl.className = 'item-time';
    timeEl.textContent = formatTime(item.started, timeZone);
    row.appendChild(timeEl);
  }

  row.appendChild(statusEl);

  if (item.comment) {
    const commentEl = document.createElement('span');
    commentEl.className = 'item-worklog-comment';
    commentEl.textContent = item.comment;
    commentEl.title = item.comment;
    row.appendChild(commentEl);
  }

  row.appendChild(hoursEl);
  return row;
}

function renderDay(day, timeZone) {
  const wrap = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'item-group-header';
  header.textContent = day.label;
  wrap.appendChild(header);

  for (const item of day.items) {
    wrap.appendChild(renderWorklogRow(item, timeZone));
  }

  return wrap;
}

async function render() {
  const { summaryPayload } = await chrome.storage.session.get('summaryPayload');
  const daysEl = $('days');

  if (!summaryPayload) {
    daysEl.innerHTML = '<p class="empty-state">No summary data found. Open this page from the “Open summary in new tab” button in the side panel.</p>';
    return;
  }

  // One-shot handoff — clear it so reopening this URL directly later (not via
  // the panel's button) doesn't show a stale summary from a past search.
  chrome.storage.session.remove('summaryPayload');

  $('range-label').textContent = summaryPayload.rangeLabel;
  $('filters-label').textContent = summaryPayload.filters.join(' · ');

  if (summaryPayload.days.length === 0) {
    daysEl.innerHTML = '<p class="empty-state">No logged worklogs match the current filters.</p>';
    return;
  }

  const timeZone = summaryPayload.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (const day of summaryPayload.days) {
    daysEl.appendChild(renderDay(day, timeZone));
  }
}

render();
