import { formatShortDate, formatTime } from '../lib/dates.js';

const $ = (id) => document.getElementById(id);

// Safe helper to format weekday and date (e.g. "Monday, Oct 12, 2026")
function formatFullDate(isoDate) {
  if (!isoDate) return '';
  try {
    const [y, m, d] = isoDate.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return formatShortDate(isoDate);
  }
}

// Format short weekday for TOC index
function formatWeekdayShort(isoDate) {
  if (!isoDate) return '';
  try {
    const [y, m, d] = isoDate.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return isoDate;
  }
}

// Formats review text lines into structured elements (handling paragraphs & lists safely)
function renderReviewContent(commentText) {
  const container = document.createElement('div');
  container.className = 'review-content-body';

  const rawLines = commentText.split(/\r?\n/);
  let currentList = null;
  let currentListType = null; // 'ul' | 'ol'

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // Check if line is a bullet item: "-", "*", "•"
    const isBullet = /^[•\-\*]\s+(.*)$/.exec(trimmed);
    // Check if line is a numbered item: "1.", "1)", etc.
    const isNumbered = /^(\d+)[\.\)]\s+(.*)$/.exec(trimmed);

    if (isBullet) {
      if (currentListType !== 'ul') {
        currentList = document.createElement('ul');
        currentList.className = 'review-list bullet-list';
        container.appendChild(currentList);
        currentListType = 'ul';
      }
      const li = document.createElement('li');
      li.textContent = isBullet[1];
      currentList.appendChild(li);
    } else if (isNumbered) {
      if (currentListType !== 'ol') {
        currentList = document.createElement('ol');
        currentList.className = 'review-list numbered-list';
        container.appendChild(currentList);
        currentListType = 'ol';
      }
      const li = document.createElement('li');
      li.textContent = isNumbered[2];
      currentList.appendChild(li);
    } else {
      // Normal paragraph line
      currentList = null;
      currentListType = null;

      if (trimmed === '') {
        // Empty line spacer
        const spacer = document.createElement('div');
        spacer.className = 'review-spacer';
        container.appendChild(spacer);
      } else {
        const p = document.createElement('p');
        p.className = 'review-paragraph';
        p.textContent = line;
        container.appendChild(p);
      }
    }
  }

  return container;
}

function renderWorklogCard(item, timeZone, baseUrl, itemIndex) {
  const card = document.createElement('article');
  card.className = 'worklog-card';

  // Level 3 Header: Item summary, key, time, status, duration
  const header = document.createElement('header');
  header.className = 'worklog-card-header';

  const leftGroup = document.createElement('div');
  leftGroup.className = 'card-header-left';

  const indexBadge = document.createElement('span');
  indexBadge.className = 'item-index-badge';
  indexBadge.textContent = `${itemIndex}.`;

  const keyEl = baseUrl ? document.createElement('a') : document.createElement('span');
  keyEl.className = 'item-key';
  keyEl.textContent = item.key;
  if (baseUrl) {
    keyEl.href = `${baseUrl}/browse/${item.key}`;
    keyEl.target = '_blank';
    keyEl.rel = 'noopener noreferrer';
  }

  const summaryEl = document.createElement('h3');
  summaryEl.className = 'item-summary';
  summaryEl.textContent = item.summary;
  summaryEl.title = item.summary;

  leftGroup.append(indexBadge, keyEl, summaryEl);

  if (item.issueType) {
    const typeBadge = document.createElement('span');
    typeBadge.className = 'item-type-badge';
    typeBadge.textContent = item.issueType;
    leftGroup.appendChild(typeBadge);
  }

  if (item.due) {
    const dueEl = document.createElement('span');
    dueEl.className = 'item-due';
    dueEl.textContent = `Due: ${formatShortDate(item.due)}`;
    leftGroup.appendChild(dueEl);
  }

  const rightGroup = document.createElement('div');
  rightGroup.className = 'card-header-right';

  if (item.started) {
    const timeEl = document.createElement('span');
    timeEl.className = 'item-time';
    timeEl.textContent = formatTime(item.started, timeZone);
    rightGroup.appendChild(timeEl);
  }

  const statusEl = document.createElement('span');
  statusEl.className = `status-chip ${item.statusCategory || 'default'}`;
  statusEl.textContent = item.statusName || 'Status';

  const hoursEl = document.createElement('span');
  hoursEl.className = 'item-hours-badge';
  hoursEl.textContent = `${(item.hours || 0).toFixed(1)}h`;

  rightGroup.append(statusEl, hoursEl);
  header.append(leftGroup, rightGroup);
  card.appendChild(header);

  // Level 4: Worklog Review / Description Section (Indented block)
  if (item.comment && item.comment.trim() !== '') {
    const reviewSection = document.createElement('div');
    reviewSection.className = 'worklog-review-container';

    const reviewHeader = document.createElement('div');
    reviewHeader.className = 'worklog-review-header';

    const reviewIcon = document.createElement('span');
    reviewIcon.className = 'review-icon';
    reviewIcon.textContent = '📝';

    const reviewTitle = document.createElement('span');
    reviewTitle.className = 'review-title';
    reviewTitle.textContent = 'Review & Notes';

    reviewHeader.append(reviewIcon, reviewTitle);
    reviewSection.appendChild(reviewHeader);

    const reviewBody = renderReviewContent(item.comment);
    reviewSection.appendChild(reviewBody);

    card.appendChild(reviewSection);
  }

  return card;
}

function renderDaySection(day, timeZone, baseUrl, dayIndex) {
  const section = document.createElement('section');
  section.className = 'day-section';
  const dayId = day.date ? `day-${day.date}` : `day-${dayIndex}`;
  section.id = dayId;

  // Level 2 Heading: Day name, date, item count, total hours
  const header = document.createElement('header');
  header.className = 'day-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'day-title-group';

  const dayIndexPill = document.createElement('span');
  dayIndexPill.className = 'day-index-pill';
  dayIndexPill.textContent = `Day ${dayIndex}`;

  const h2 = document.createElement('h2');
  h2.className = 'day-title';
  h2.textContent = day.date ? formatFullDate(day.date) : day.label;

  titleGroup.append(dayIndexPill, h2);

  const metaGroup = document.createElement('div');
  metaGroup.className = 'day-meta-group';

  const countBadge = document.createElement('span');
  countBadge.className = 'day-count-badge';
  const entryCount = day.items.length;
  countBadge.textContent = `${entryCount} ${entryCount === 1 ? 'worklog' : 'worklogs'}`;

  const totalHours = day.totalHours != null
    ? day.totalHours
    : day.items.reduce((sum, it) => sum + (it.hours || 0), 0);

  const hoursBadge = document.createElement('span');
  hoursBadge.className = 'day-hours-badge';
  hoursBadge.textContent = `${totalHours.toFixed(1)}h logged`;

  metaGroup.append(countBadge, hoursBadge);
  header.append(titleGroup, metaGroup);
  section.appendChild(header);

  const itemsContainer = document.createElement('div');
  itemsContainer.className = 'day-items-container';

  day.items.forEach((item, idx) => {
    itemsContainer.appendChild(renderWorklogCard(item, timeZone, baseUrl, idx + 1));
  });

  section.appendChild(itemsContainer);
  return section;
}

function renderUnloggedSection(unloggedItems, baseUrl) {
  if (!unloggedItems || unloggedItems.length === 0) return null;

  const section = document.createElement('section');
  section.className = 'unlogged-section-container';

  const header = document.createElement('header');
  header.className = 'unlogged-header';

  const h2 = document.createElement('h2');
  h2.className = 'unlogged-title';
  h2.textContent = `⚠️ Pending — Unlogged Work Items (${unloggedItems.length})`;

  header.appendChild(h2);
  section.appendChild(header);

  const list = document.createElement('div');
  list.className = 'unlogged-items-container';

  unloggedItems.forEach((item, idx) => {
    const card = document.createElement('article');
    card.className = 'worklog-card is-unlogged';

    const cardHeader = document.createElement('header');
    cardHeader.className = 'worklog-card-header';

    const leftGroup = document.createElement('div');
    leftGroup.className = 'card-header-left';

    const indexBadge = document.createElement('span');
    indexBadge.className = 'item-index-badge';
    indexBadge.textContent = `${idx + 1}.`;

    const keyEl = baseUrl ? document.createElement('a') : document.createElement('span');
    keyEl.className = 'item-key';
    keyEl.textContent = item.key;
    if (baseUrl) {
      keyEl.href = `${baseUrl}/browse/${item.key}`;
      keyEl.target = '_blank';
      keyEl.rel = 'noopener noreferrer';
    }

    const summaryEl = document.createElement('h3');
    summaryEl.className = 'item-summary';
    summaryEl.textContent = item.summary;

    leftGroup.append(indexBadge, keyEl, summaryEl);

    if (item.issueType) {
      const typeBadge = document.createElement('span');
      typeBadge.className = 'item-type-badge';
      typeBadge.textContent = item.issueType;
      leftGroup.appendChild(typeBadge);
    }

    if (item.due) {
      const dueEl = document.createElement('span');
      dueEl.className = 'item-due';
      dueEl.textContent = `Due: ${formatShortDate(item.due)}`;
      leftGroup.appendChild(dueEl);
    }

    const rightGroup = document.createElement('div');
    rightGroup.className = 'card-header-right';

    const statusEl = document.createElement('span');
    statusEl.className = `status-chip ${item.statusCategory || 'default'}`;
    statusEl.textContent = item.statusName || 'Status';

    const hoursEl = document.createElement('span');
    hoursEl.className = 'item-hours-badge unlogged-hours-badge';
    hoursEl.textContent = 'No worklog';

    rightGroup.append(statusEl, hoursEl);
    cardHeader.append(leftGroup, rightGroup);
    card.appendChild(cardHeader);
    list.appendChild(card);
  });

  section.appendChild(list);
  return section;
}

function renderKpis(days, unlogged) {
  const kpiContainer = $('kpi-metrics');
  if (!kpiContainer) return;
  kpiContainer.innerHTML = '';

  let totalSeconds = 0;
  let totalEntries = 0;

  for (const day of days) {
    totalEntries += day.items.length;
    for (const item of day.items) {
      totalSeconds += (item.hours || 0) * 3600;
    }
  }

  const totalHours = totalSeconds / 3600;
  const activeDays = days.length;
  const unloggedCount = unlogged ? unlogged.length : 0;

  const metrics = [
    { label: 'Total Logged Time', value: `${totalHours.toFixed(1)}h`, icon: '⏱️' },
    { label: 'Active Days', value: `${activeDays}`, icon: '📅' },
    { label: 'Worklog Entries', value: `${totalEntries}`, icon: '📋' },
    ...(unloggedCount > 0 ? [{ label: 'Pending Items', value: `${unloggedCount}`, icon: '⚠️', alert: true }] : []),
  ];

  metrics.forEach((m) => {
    const card = document.createElement('div');
    card.className = `kpi-card ${m.alert ? 'kpi-alert' : ''}`;

    const top = document.createElement('div');
    top.className = 'kpi-top';

    const icon = document.createElement('span');
    icon.className = 'kpi-icon';
    icon.textContent = m.icon;

    const label = document.createElement('span');
    label.className = 'kpi-label';
    label.textContent = m.label;

    top.append(icon, label);

    const val = document.createElement('div');
    val.className = 'kpi-value';
    val.textContent = m.value;

    card.append(top, val);
    kpiContainer.appendChild(card);
  });
}

function renderToc(days) {
  const tocEl = $('summary-toc');
  if (!tocEl) return;
  tocEl.innerHTML = '';

  if (!days || days.length === 0) return;

  const title = document.createElement('span');
  title.className = 'toc-title';
  title.textContent = 'Weekly Index:';
  tocEl.appendChild(title);

  const list = document.createElement('div');
  list.className = 'toc-list';

  days.forEach((day, idx) => {
    const link = document.createElement('a');
    const dayId = day.date ? `day-${day.date}` : `day-${idx + 1}`;
    link.href = `#${dayId}`;
    link.className = 'toc-item';

    const dayName = day.date ? formatWeekdayShort(day.date) : `Day ${idx + 1}`;
    const totalHours = day.totalHours != null
      ? day.totalHours
      : day.items.reduce((s, i) => s + (i.hours || 0), 0);

    const daySpan = document.createElement('span');
    daySpan.className = 'toc-day';
    daySpan.textContent = dayName;

    const hoursSpan = document.createElement('span');
    hoursSpan.className = 'toc-hours';
    hoursSpan.textContent = `${totalHours.toFixed(1)}h`;

    link.append(daySpan, hoursSpan);
    list.appendChild(link);
  });

  tocEl.appendChild(list);
}

async function render() {
  const { summaryPayload } = await chrome.storage.session.get('summaryPayload');
  const daysEl = $('days');
  const unloggedEl = $('unlogged');

  if (!summaryPayload) {
    daysEl.innerHTML = '<p class="empty-state">No summary data found. Open this page from the “Open summary in new tab” button in the side panel.</p>';
    return;
  }

  // One-shot handoff — clear it so reopening this URL directly later doesn't show stale data.
  chrome.storage.session.remove('summaryPayload');

  const rangeLabel = $('range-label');
  if (rangeLabel) rangeLabel.textContent = summaryPayload.rangeLabel || '';

  const filtersLabel = $('filters-label');
  if (filtersLabel) {
    if (summaryPayload.filters && summaryPayload.filters.length > 0) {
      filtersLabel.textContent = `Applied filters: ${summaryPayload.filters.join(' · ')}`;
    } else {
      filtersLabel.textContent = 'All assigned items in selected period';
    }
  }

  if (summaryPayload.days.length === 0 && (!summaryPayload.unlogged || summaryPayload.unlogged.length === 0)) {
    daysEl.innerHTML = '<p class="empty-state">No logged worklogs match the current filters.</p>';
    return;
  }

  const timeZone = summaryPayload.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const baseUrl = summaryPayload.baseUrl || null;

  renderKpis(summaryPayload.days, summaryPayload.unlogged);
  renderToc(summaryPayload.days);

  summaryPayload.days.forEach((day, idx) => {
    daysEl.appendChild(renderDaySection(day, timeZone, baseUrl, idx + 1));
  });

  if (unloggedEl && summaryPayload.unlogged && summaryPayload.unlogged.length > 0) {
    const unloggedWrap = renderUnloggedSection(summaryPayload.unlogged, baseUrl);
    if (unloggedWrap) unloggedEl.appendChild(unloggedWrap);
  }
}

render();
