import { formatShortDate } from '../lib/dates.js';

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function renderDay(day) {
  const wrap = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'item-group-header';
  header.textContent = day.label;
  wrap.appendChild(header);

  for (const item of day.items) {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <span class="item-key">${escapeHtml(item.key)}</span>
      <span class="item-summary" title="${escapeHtml(item.summary)}">${escapeHtml(item.summary)}</span>
      <span class="status-chip ${item.statusCategory}">${escapeHtml(item.statusName)}</span>
      <span class="item-due">${item.due ? formatShortDate(item.due) : '—'}</span>
      <span class="item-hours">${item.hours.toFixed(1)}h</span>
    `;
    wrap.appendChild(row);

    for (const comment of item.comments) {
      const commentEl = document.createElement('div');
      commentEl.className = 'item-worklog-comment';
      commentEl.textContent = comment;
      wrap.appendChild(commentEl);
    }
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

  for (const day of summaryPayload.days) {
    daysEl.appendChild(renderDay(day));
  }
}

render();
