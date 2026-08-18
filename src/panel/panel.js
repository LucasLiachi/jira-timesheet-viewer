import { request } from '../lib/messaging.js';
import { mountConnectForm } from '../lib/connect-form.js';
import { todayISO, formatShortDate, formatTime, enumerateDates } from '../lib/dates.js';
import { renderMonth, monthLabel } from './calendar.js';
import { renderMultiSelect } from './multi-select.js';

const $ = (id) => document.getElementById(id);
const who = $('who');
const disconnectBtn = $('disconnect');
const app = $('app');
const connectContainer = $('connect-container');
const calendarEl = $('calendar');
const monthLabelEl = $('month-label');
const rangeHint = $('range-hint');
const periodTotalEl = $('period-total');
const timesheetStatus = $('timesheet-status');
const timesheetListEl = $('timesheet-list');
const searchBtn = $('search-btn');
const summaryBtn = $('open-summary');
const searchMyItemsBtn = $('search-my-items-btn');

// Context 2 — My Items
const projectFilterEl = $('project-filter');
const statusFilterEl = $('status-filter');
const issueTypeFilterEl = $('issue-type-filter');
const workItemFilterInput = $('work-item-filter');
const unloggedOnlyFilterInput = $('unlogged-only-filter');
const unloggedCountBadge = $('unlogged-count-badge');
const myItemsStatus = $('my-items-status');
const myItemsListEl = $('my-items-list');

// Tracks the tab this panel last opened for "view issue in Jira", so
// clicking another issue reuses it instead of piling up a new tab per click.
// Only ever touches a tab we ourselves opened — never an unrelated Jira tab
// the user already had open, which could be mid-edit on something else.
let issueTabId = null;

async function openIssue(url) {
  if (issueTabId !== null) {
    try {
      const tab = await chrome.tabs.get(issueTabId);
      await chrome.tabs.update(issueTabId, { url, active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch {
      issueTabId = null; // tab was closed since — fall through and open a new one
    }
  }
  const tab = await chrome.tabs.create({ url });
  issueTabId = tab.id;
}

const now = new Date();
const state = {
  connected: false,
  displayName: '',
  baseUrl: '',
  timeZone: 'America/Sao_Paulo',
  year: now.getFullYear(),
  month: now.getMonth(),
  range: null, // { from, to }
  pendingStart: null,

  // Context 1 — Timesheet (worklogs in the period)
  timesheetItems: [],
  timesheetLoading: false,

  // Context 2 — My Items (assigned issues, ownership view)
  myItems: [],
  myItemsLoading: false,

  // Project filter — narrows what SEARCH_MY_ITEMS's JQL asks for. `selectedProjects`
  // is null until the user opens this filter at least once (meaning "no
  // restriction, search every project"); once loaded it's a Set of project
  // keys, defaulting to all of them selected.
  projectOptions: [],
  selectedProjects: null,
  projectFilterOpen: false,
  projectsLoading: false,
  projectsError: false,
  projectsErrorMessage: '',

  // Status filter — a client-side sub-filter over whatever SEARCH_MY_ITEMS
  // already returned, never touches the network. Reset to "every status
  // selected" each time a new search comes back.
  statusOptions: [],
  selectedStatuses: new Set(),
  statusFilterOpen: false,

  // Issue type filter — same client-side sub-filter pattern as status,
  // just over `issueType` instead of `statusName`. Sits after status and
  // before the work item text filter.
  issueTypeOptions: [],
  selectedIssueTypes: new Set(),
  issueTypeFilterOpen: false,

  // Work item filter — last of the four, a plain text sub-filter (not a
  // checkbox popover like the others, since issues aren't a small
  // enumerable set) matching against key or summary. Client-side only, same
  // as the status and issue type filters.
  workItemQuery: '',

  // Filter for unlogged items only
  unloggedOnly: false,
};

mountConnectForm(connectContainer, { onConnected: onConnected });

async function onConnected() {
  await refreshConnection();
}

async function refreshConnection() {
  const status = await request('GET_CONNECTION_STATUS');
  state.connected = status.connected;
  state.displayName = status.displayName ?? '';
  state.baseUrl = status.baseUrl ?? '';
  state.timeZone = status.timeZone || state.timeZone;
  renderHeader();
  connectContainer.hidden = state.connected;
  app.hidden = !state.connected;
  if (state.connected) {
    renderCalendar();
    renderProjectFilter();
    renderStatusFilter();
    renderIssueTypeFilter();
  }
}

function renderHeader() {
  who.textContent = state.connected ? `${state.displayName} · Connected` : 'Not connected';
  disconnectBtn.hidden = !state.connected;
}

function renderCalendar() {
  monthLabelEl.textContent = monthLabel(state.year, state.month);
  renderMonth(calendarEl, {
    year: state.year,
    month: state.month,
    range: state.range,
    pendingStart: state.pendingStart,
    today: todayISO(state.timeZone),
    onDayClick: handleDayClick,
  });
}

// Two clicks pick a period (start, then end); any click after that starts a
// new period. Selecting a range enables the Search button — the user clicks
// it explicitly to fire both context searches.
function handleDayClick(iso) {
  if (!state.pendingStart) {
    state.range = null;
    state.pendingStart = iso;
    searchBtn.disabled = true;
    renderCalendar();
    renderTimesheetList();
    renderMyItemsList();
    return;
  }

  const from = iso < state.pendingStart ? iso : state.pendingStart;
  const to = iso < state.pendingStart ? state.pendingStart : iso;
  state.pendingStart = null;
  state.range = { from, to };
  searchBtn.disabled = false;
  if (searchMyItemsBtn) searchMyItemsBtn.disabled = false;
  rangeHint.textContent = `${formatShortDate(state.range.from)} – ${formatShortDate(state.range.to)}`;
  renderCalendar();
}

// ──────────────────────────────────────────────────────────────────────
// Context 2 — My Items: project / status / type / text filters
// ──────────────────────────────────────────────────────────────────────

function renderProjectFilter() {
  renderMultiSelect(projectFilterEl, {
    label: 'Projects',
    options: state.projectOptions,
    selected: state.selectedProjects ?? new Set(),
    open: state.projectFilterOpen,
    onToggleOpen: handleProjectToggleOpen,
    onToggleValue: handleProjectToggleValue,
    onToggleAll: handleProjectToggleAll,
    emptyLabel: state.projectsError
      ? `Could not load projects: ${state.projectsErrorMessage}`
      : state.projectsLoading
      ? 'Loading…'
      : 'No projects found.',
  });
}

// Ignores repeat clicks while a GET_PROJECTS fetch is already in flight —
// without this guard, a second click on the button (or an incidental
// outside click) while "Loading…" is showing flips `projectFilterOpen` back
// to false, and the popover stays closed once the fetch lands even though
// the data arrived fine: it just never gets shown, which reads as "the
// project filter doesn't work" from the outside.
async function handleProjectToggleOpen() {
  if (state.projectsLoading) return;

  state.projectFilterOpen = !state.projectFilterOpen;
  const shouldFetch = state.projectFilterOpen && state.projectOptions.length === 0;
  if (shouldFetch) {
    state.projectsLoading = true;
    state.projectsError = false;
  }
  renderProjectFilter();

  if (shouldFetch) {
    try {
      const { projects } = await request('GET_PROJECTS');
      state.projectOptions = projects.map((p) => ({ value: p.key, label: `${p.key} — ${p.name}` }));
      // A genuinely empty result (account can see zero projects, or the
      // endpoint hiccuped) must NOT become an empty Set — that's the same
      // shape as "user unchecked every box," which runMyItemsSearch()/
      // renderMyItemsList() read as "search nothing" and use to block every
      // date-range search from then on, for reasons that have nothing to do
      // with the dates picked. Leave it null (= no restriction) when there's
      // nothing to restrict by in the first place.
      state.selectedProjects =
        state.projectOptions.length > 0 ? new Set(state.projectOptions.map((o) => o.value)) : null;
    } catch (err) {
      state.projectsError = true;
      state.projectsErrorMessage = err?.message || 'Unknown error';
    } finally {
      state.projectsLoading = false;
      renderProjectFilter();
    }
  }
}

function handleProjectToggleValue(value) {
  if (!state.selectedProjects) return;
  if (state.selectedProjects.has(value)) state.selectedProjects.delete(value);
  else state.selectedProjects.add(value);
  renderProjectFilter();
}

function handleProjectToggleAll(makeSelected) {
  state.selectedProjects = makeSelected ? new Set(state.projectOptions.map((o) => o.value)) : new Set();
  renderProjectFilter();
}

function renderStatusFilter() {
  renderMultiSelect(statusFilterEl, {
    label: 'Status',
    options: state.statusOptions,
    selected: state.selectedStatuses,
    open: state.statusFilterOpen,
    onToggleOpen: handleStatusToggleOpen,
    onToggleValue: handleStatusToggleValue,
    onToggleAll: handleStatusToggleAll,
    emptyLabel: 'Search a period to see statuses.',
  });
}

function handleStatusToggleOpen() {
  state.statusFilterOpen = !state.statusFilterOpen;
  renderStatusFilter();
}

function handleStatusToggleValue(value) {
  if (state.selectedStatuses.has(value)) state.selectedStatuses.delete(value);
  else state.selectedStatuses.add(value);
  renderStatusFilter();
  renderMyItemsList();
}

function handleStatusToggleAll(makeSelected) {
  state.selectedStatuses = makeSelected ? new Set(state.statusOptions.map((o) => o.value)) : new Set();
  renderStatusFilter();
  renderMyItemsList();
}

function resetStatusFilterFromMyItems() {
  const names = [...new Set(state.myItems.map((item) => item.statusName).filter(Boolean))].sort();
  state.statusOptions = names.map((name) => ({ value: name, label: name }));
  state.selectedStatuses = new Set(names);
}

function renderIssueTypeFilter() {
  renderMultiSelect(issueTypeFilterEl, {
    label: 'Type',
    options: state.issueTypeOptions,
    selected: state.selectedIssueTypes,
    open: state.issueTypeFilterOpen,
    onToggleOpen: handleIssueTypeToggleOpen,
    onToggleValue: handleIssueTypeToggleValue,
    onToggleAll: handleIssueTypeToggleAll,
    emptyLabel: 'Search a period to see item types.',
  });
}

function handleIssueTypeToggleOpen() {
  state.issueTypeFilterOpen = !state.issueTypeFilterOpen;
  renderIssueTypeFilter();
}

function handleIssueTypeToggleValue(value) {
  if (state.selectedIssueTypes.has(value)) state.selectedIssueTypes.delete(value);
  else state.selectedIssueTypes.add(value);
  renderIssueTypeFilter();
  renderMyItemsList();
}

function handleIssueTypeToggleAll(makeSelected) {
  state.selectedIssueTypes = makeSelected ? new Set(state.issueTypeOptions.map((o) => o.value)) : new Set();
  renderIssueTypeFilter();
  renderMyItemsList();
}

function resetIssueTypeFilterFromMyItems() {
  const names = [...new Set(state.myItems.map((item) => item.issueType).filter(Boolean))].sort();
  state.issueTypeOptions = names.map((name) => ({ value: name, label: name }));
  state.selectedIssueTypes = new Set(names);
}

// Close whichever filter popover is open when the user clicks outside it.
// Uses composedPath() (the DOM path captured at dispatch time), not
// contains(), because the checkbox/button the user just clicked is replaced
// (re-rendered) by its own handler before this listener runs — a plain
// containment check against the now-detached original node would always
// say "outside" and close the popover it just opened.
document.addEventListener('click', (e) => {
  const path = e.composedPath();
  if (state.projectFilterOpen && !state.projectsLoading && !path.includes(projectFilterEl)) {
    state.projectFilterOpen = false;
    renderProjectFilter();
  }
  if (state.statusFilterOpen && !path.includes(statusFilterEl)) {
    state.statusFilterOpen = false;
    renderStatusFilter();
  }
  if (state.issueTypeFilterOpen && !path.includes(issueTypeFilterEl)) {
    state.issueTypeFilterOpen = false;
    renderIssueTypeFilter();
  }
});

// ──────────────────────────────────────────────────────────────────────
// Searches
// ──────────────────────────────────────────────────────────────────────

// Context 1 — Timesheet: worklogs the user logged in the period.
async function runTimesheetSearch() {
  state.timesheetLoading = true;
  renderCalendar();
  renderTimesheetList();

  try {
    const result = await request('SEARCH_WORKLOGS', {
      from: state.range.from,
      to: state.range.to,
    });
    state.timesheetItems = result.issues;
    state.baseUrl = result.baseUrl || state.baseUrl;
  } catch (err) {
    if (err.code === 'NOT_CONNECTED') {
      await refreshConnection();
      return;
    }
    timesheetStatus.textContent = `Something went wrong: ${err.message}`;
    state.timesheetItems = [];
  } finally {
    state.timesheetLoading = false;
    renderCalendar();
    renderTimesheetList();
  }
}

// Context 2 — My Items: issues assigned to the user.
async function runMyItemsSearch() {
  // Explicitly zero projects selected means "search nothing", not "no
  // restriction" — skip the network call rather than send a query that
  // can't match anything.
  if (state.selectedProjects && state.selectedProjects.size === 0) {
    state.myItems = [];
    renderMyItemsList();
    return;
  }

  state.myItemsLoading = true;
  renderMyItemsList();

  const projectKeys =
    state.selectedProjects && state.selectedProjects.size < state.projectOptions.length
      ? [...state.selectedProjects]
      : [];

  try {
    const result = await request('SEARCH_MY_ITEMS', {
      from: state.range.from,
      to: state.range.to,
      projectKeys,
    });
    state.myItems = result.issues;
    state.baseUrl = result.baseUrl || state.baseUrl;
    resetStatusFilterFromMyItems();
    resetIssueTypeFilterFromMyItems();
  } catch (err) {
    if (err.code === 'NOT_CONNECTED') {
      await refreshConnection();
      return;
    }
    myItemsStatus.textContent = `Something went wrong: ${err.message}`;
    state.myItems = [];
  } finally {
    state.myItemsLoading = false;
    renderStatusFilter();
    renderIssueTypeFilter();
    renderMyItemsList();
  }
}

// ──────────────────────────────────────────────────────────────────────
// Context 1 — Timesheet rendering
// ──────────────────────────────────────────────────────────────────────

function renderTimesheetList() {
  timesheetListEl.innerHTML = '';
  summaryBtn.disabled = true;

  if (!state.range) {
    timesheetStatus.textContent = 'Pick a start and end date on the calendar to search.';
    rangeHint.textContent = '';
    periodTotalEl.textContent = '';
    return;
  }

  rangeHint.textContent = `${formatShortDate(state.range.from)} – ${formatShortDate(state.range.to)}`;
  periodTotalEl.textContent = '';

  if (state.timesheetLoading) {
    timesheetStatus.textContent = 'Loading worklogs…';
    return;
  }

  if (state.timesheetItems.length === 0) {
    timesheetStatus.textContent = 'No worklogs found in this period.';
    return;
  }

  timesheetStatus.textContent = 'Grouped by day logged. Click an issue to open it in Jira.';
  summaryBtn.disabled = false;

  // One group per day in the picked range, oldest first, each showing
  // every worklog logged that day across all issues, in the order they
  // were actually logged — not grouped by issue, so a worklog on one issue
  // interleaves with worklogs on other issues instead of staying block by
  // block. Days with nothing logged still render — a missing day should be
  // visible, not silently skipped.
  let periodTotalSeconds = 0;
  for (const day of enumerateDates(state.range.from, state.range.to)) {
    const dayEntries = collectDayEntries(state.timesheetItems, day);
    const uniqueItemCount = new Set(dayEntries.map(({ item }) => item.key)).size;
    const dayTotalSeconds = dayEntries.reduce((sum, { entry }) => sum + entry.seconds, 0);
    periodTotalSeconds += dayTotalSeconds;

    const title =
      dayEntries.length > 0
        ? `${formatShortDate(day)} · ${uniqueItemCount} ${uniqueItemCount === 1 ? 'item' : 'items'} · ${(
            dayTotalSeconds / 3600
          ).toFixed(1)}h`
        : `${formatShortDate(day)} · No worklogs`;

    timesheetListEl.appendChild(renderGroup(title, dayEntries));
  }
  periodTotalEl.textContent = `Total logged: ${(periodTotalSeconds / 3600).toFixed(1)}h`;
}

// ──────────────────────────────────────────────────────────────────────
// Context 2 — My Items rendering
// ──────────────────────────────────────────────────────────────────────

// Applies status + type + text + unlogged filters over whatever
// SEARCH_MY_ITEMS returned — exactly one place defines "what's currently
// visible" in the My Items list.
function getVisibleMyItems() {
  let visibleItems = state.myItems.filter((item) => state.selectedStatuses.has(item.statusName));
  visibleItems = visibleItems.filter((item) => state.selectedIssueTypes.has(item.issueType));
  if (state.workItemQuery) {
    visibleItems = visibleItems.filter(
      (item) =>
        item.key.toLowerCase().includes(state.workItemQuery) ||
        item.summary.toLowerCase().includes(state.workItemQuery)
    );
  }
  if (state.unloggedOnly) {
    visibleItems = visibleItems.filter((item) => {
      const total = Object.values(item.logsByDay ?? {}).reduce((sum, log) => sum + log.seconds, 0);
      return total === 0;
    });
  }
  return visibleItems;
}

function renderMyItemsList() {
  myItemsListEl.innerHTML = '';

  if (!state.range) {
    myItemsStatus.textContent = 'Pick a date range above to see your assigned items.';
    return;
  }

  if (state.myItemsLoading) {
    myItemsStatus.textContent = 'Loading items…';
    return;
  }

  if (state.selectedProjects && state.selectedProjects.size === 0) {
    myItemsStatus.textContent = 'Select at least one project to search.';
    return;
  }

  if (state.myItems.length === 0) {
    myItemsStatus.textContent = 'No issues assigned to you in this period.';
    return;
  }

  if (state.selectedStatuses.size === 0) {
    myItemsStatus.textContent = 'Select at least one status to show items.';
    return;
  }

  if (state.selectedIssueTypes.size === 0) {
    myItemsStatus.textContent = 'Select at least one item type to show items.';
    return;
  }

  myItemsStatus.textContent = 'Click an issue to open it in Jira.';

  const visibleItems = getVisibleMyItems();

  // Count unlogged items for the badge (based on base-filtered items,
  // before the text and unloggedOnly filters narrow further).
  const baseVisible = state.myItems
    .filter((item) => state.selectedStatuses.has(item.statusName))
    .filter((item) => state.selectedIssueTypes.has(item.issueType));

  const unloggedCount = baseVisible.filter((item) => {
    const total = Object.values(item.logsByDay ?? {}).reduce((sum, log) => sum + log.seconds, 0);
    return total === 0;
  }).length;

  if (unloggedCountBadge) {
    if (unloggedCount > 0) {
      unloggedCountBadge.textContent = `⚠️ ${unloggedCount} unlogged`;
      unloggedCountBadge.title = `${unloggedCount} item(s) without logged hours in this period`;
      unloggedCountBadge.hidden = false;
    } else {
      unloggedCountBadge.hidden = true;
    }
  }

  // All items as a flat "Not logged in this period" group — the ownership
  // view is about what you're responsible for, with unlogged emphasis.
  const notLogged = visibleItems.filter((item) => {
    const total = Object.values(item.logsByDay ?? {}).reduce((sum, log) => sum + log.seconds, 0);
    return total === 0;
  });

  const logged = visibleItems.filter((item) => {
    const total = Object.values(item.logsByDay ?? {}).reduce((sum, log) => sum + log.seconds, 0);
    return total > 0;
  });

  if (notLogged.length > 0) {
    myItemsListEl.appendChild(
      renderGroup(
        `Not logged in this period (${notLogged.length})`,
        notLogged.map((item) => ({ item, entry: { seconds: item.estimateSeconds, comment: '' }, isUnloggedGroup: true }))
      )
    );
  }

  if (logged.length > 0) {
    myItemsListEl.appendChild(
      renderGroup(
        `Logged in this period (${logged.length})`,
        logged.map((item) => {
          const totalSec = Object.values(item.logsByDay ?? {}).reduce((s, l) => s + l.seconds, 0);
          return { item, entry: { seconds: totalSec, comment: '' } };
        })
      )
    );
  }

  if (visibleItems.length === 0) {
    myItemsStatus.textContent = 'No items match the current filters.';
  }
}

// ──────────────────────────────────────────────────────────────────────
// Shared rendering helpers
// ──────────────────────────────────────────────────────────────────────

// Flattens every visible issue's worklogs for `day` into one list, sorted
// by the worklog's own timestamp. The unit here is a worklog, not an
// issue — the same issue can log more than once in a day, and each of
// those needs to interleave with other issues' worklogs by time rather
// than staying grouped under one row per issue.
function collectDayEntries(items, day) {
  const dayEntries = [];
  for (const item of items) {
    const dayLog = item.logsByDay?.[day];
    if (!dayLog) continue;
    for (const entry of dayLog.entries) {
      dayEntries.push({ item, entry });
    }
  }
  dayEntries.sort((a, b) => a.entry.started - b.entry.started);
  return dayEntries;
}

function renderGroup(title, dayEntries) {
  const wrap = document.createElement('div');
  const header = document.createElement('div');
  header.className = 'item-group-header';
  header.textContent = title;
  wrap.appendChild(header);

  const today = todayISO(state.timeZone);
  for (const { item, entry } of dayEntries) {
    wrap.appendChild(renderWorklogRow(item, entry, today));
  }
  return wrap;
}

// Two rows, three columns: [key | title+due | start time] over
// [status | worklog description | logged hours]. See panel.css for how the
// six cells are placed on the grid. Built with createElement/textContent
// rather than innerHTML so summary/comment text — free-form Jira content —
// never has to be manually escaped, including inside the `title` tooltip
// attribute, where a naive string-escaping helper (escaping for element text,
// not for attribute context) would still let a stray `"` break out.
function renderWorklogRow(item, entry, today) {
  const seconds = entry?.seconds ?? 0;
  const comment = entry?.comment ?? '';
  const started = entry?.started;
  const overdue = item.due && item.due < today && item.statusCategory !== 'done';
  const isUnlogged = entry?.isUnloggedGroup || (!seconds && !started);

  const row = document.createElement('div');
  row.className = `item-row${overdue ? ' is-overdue' : ''}${isUnlogged ? ' is-unlogged' : ''}`;
  row.title = 'Open in Jira';

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
    dueEl.className = `item-due${overdue ? ' is-overdue-text' : ''}`;
    if (overdue) dueEl.setAttribute('aria-label', 'Overdue');
    dueEl.textContent = formatShortDate(item.due);
    titleCell.appendChild(dueEl);
  }

  const statusEl = document.createElement('span');
  statusEl.className = `status-chip ${item.statusCategory}`;
  statusEl.textContent = item.statusName;

  const hoursEl = document.createElement('span');
  hoursEl.className = 'item-hours-value';
  hoursEl.textContent = seconds ? (seconds / 3600).toFixed(1) + 'h' : '—';

  row.append(key, titleCell);

  if (started) {
    const timeEl = document.createElement('span');
    timeEl.className = 'item-time';
    timeEl.textContent = formatTime(started, state.timeZone);
    row.appendChild(timeEl);
  }

  row.appendChild(statusEl);

  if (comment) {
    const commentEl = document.createElement('span');
    commentEl.className = 'item-worklog-comment';
    commentEl.textContent = comment;
    commentEl.title = comment;
    row.appendChild(commentEl);
  }

  row.appendChild(hoursEl);

  row.addEventListener('click', () => {
    if (state.baseUrl) openIssue(`${state.baseUrl}/browse/${item.key}`);
  });
  return row;
}

// ──────────────────────────────────────────────────────────────────────
// Summary helpers
// ──────────────────────────────────────────────────────────────────────

// Only describes filters that actually narrow something — "everything
// selected" (the default) isn't a filter that was applied, so it's left out
// rather than listed as "Projects: all of them".
function buildFilterSummary() {
  const parts = [];
  if (state.selectedProjects && state.selectedProjects.size < state.projectOptions.length) {
    parts.push(`Projects: ${[...state.selectedProjects].sort().join(', ')}`);
  }
  if (state.selectedStatuses.size < state.statusOptions.length) {
    parts.push(`Status: ${[...state.selectedStatuses].sort().join(', ')}`);
  }
  if (state.selectedIssueTypes.size < state.issueTypeOptions.length) {
    parts.push(`Type: ${[...state.selectedIssueTypes].sort().join(', ')}`);
  }
  const query = workItemFilterInput.value.trim();
  if (query) {
    parts.push(`Search: "${query}"`);
  }
  return parts;
}

// The data behind "Open summary in new tab" — day grouping from the
// Timesheet context, skipping days with nothing logged: this is a record
// of work done.
function buildDaySummaries() {
  const days = [];

  for (const day of enumerateDates(state.range.from, state.range.to)) {
    const dayEntries = collectDayEntries(state.timesheetItems, day);
    if (dayEntries.length === 0) continue;

    const uniqueItemCount = new Set(dayEntries.map(({ item }) => item.key)).size;
    const totalSeconds = dayEntries.reduce((sum, { entry }) => sum + entry.seconds, 0);
    days.push({
      date: day,
      label: `${formatShortDate(day)} · ${uniqueItemCount} ${uniqueItemCount === 1 ? 'item' : 'items'} · ${(
        totalSeconds / 3600
      ).toFixed(1)}h`,
      itemCount: uniqueItemCount,
      totalHours: totalSeconds / 3600,
      totalSeconds,
      items: dayEntries.map(({ item, entry }) => ({
        key: item.key,
        summary: item.summary,
        statusName: item.statusName,
        statusCategory: item.statusCategory,
        issueType: item.issueType,
        due: item.due,
        hours: entry.seconds / 3600,
        comment: entry.comment,
        started: entry.started,
      })),
    });
  }

  return days;
}

// Unlogged items from the My Items context for the summary page.
function buildUnloggedSummaries() {
  const visibleItems = getVisibleMyItems();
  const notLogged = visibleItems.filter((item) => {
    const total = Object.values(item.logsByDay ?? {}).reduce((sum, log) => sum + log.seconds, 0);
    return total === 0;
  });
  return notLogged.map((item) => ({
    key: item.key,
    summary: item.summary,
    statusName: item.statusName,
    statusCategory: item.statusCategory,
    issueType: item.issueType,
    due: item.due,
  }));
}

// ──────────────────────────────────────────────────────────────────────
// Event listeners
// ──────────────────────────────────────────────────────────────────────

$('prev-month').addEventListener('click', () => {
  state.month -= 1;
  if (state.month < 0) {
    state.month = 11;
    state.year -= 1;
  }
  renderCalendar();
});

$('next-month').addEventListener('click', () => {
  state.month += 1;
  if (state.month > 11) {
    state.month = 0;
    state.year += 1;
  }
  renderCalendar();
});

disconnectBtn.addEventListener('click', async () => {
  await request('DISCONNECT');
  state.range = null;
  state.pendingStart = null;
  state.timesheetItems = [];
  state.myItems = [];
  state.projectOptions = [];
  state.selectedProjects = null;
  state.projectFilterOpen = false;
  state.projectsError = false;
  state.projectsErrorMessage = '';
  state.statusOptions = [];
  state.selectedStatuses = new Set();
  state.statusFilterOpen = false;
  state.issueTypeOptions = [];
  state.selectedIssueTypes = new Set();
  state.issueTypeFilterOpen = false;
  state.workItemQuery = '';
  workItemFilterInput.value = '';
  state.unloggedOnly = false;
  if (unloggedOnlyFilterInput) unloggedOnlyFilterInput.checked = false;
  searchBtn.disabled = true;
  if (searchMyItemsBtn) searchMyItemsBtn.disabled = true;
  summaryBtn.disabled = true;
  await refreshConnection();
});

// Explicit search button for Timesheet
searchBtn.addEventListener('click', () => {
  if (state.range) runTimesheetSearch();
});

// Explicit search button for My Items
if (searchMyItemsBtn) {
  searchMyItemsBtn.addEventListener('click', () => {
    if (state.range) runMyItemsSearch();
  });
}

if (unloggedOnlyFilterInput) {
  unloggedOnlyFilterInput.addEventListener('change', () => {
    state.unloggedOnly = unloggedOnlyFilterInput.checked;
    renderMyItemsList();
  });
}

workItemFilterInput.addEventListener('input', () => {
  state.workItemQuery = workItemFilterInput.value.trim().toLowerCase();
  renderMyItemsList();
});

// Hands the currently filtered, day-grouped data to a plain extension page
// opened in its own tab, via chrome.storage.session — the same memory-only,
// never-disk storage area the connection itself uses, just for a one-shot,
// short-lived handoff instead of a persistent session. summary.js reads and
// immediately clears this key.
summaryBtn.addEventListener('click', async () => {
  const payload = {
    rangeLabel: `${formatShortDate(state.range.from)} – ${formatShortDate(state.range.to)}`,
    range: state.range,
    baseUrl: state.baseUrl,
    filters: buildFilterSummary(),
    timeZone: state.timeZone,
    days: buildDaySummaries(),
    unlogged: buildUnloggedSummaries(),
  };
  await chrome.storage.session.set({ summaryPayload: payload });
  chrome.tabs.create({ url: chrome.runtime.getURL('src/summary/summary.html') });
});

$('open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

refreshConnection();
