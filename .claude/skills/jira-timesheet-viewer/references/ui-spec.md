# UI specification

Layout, copy and formatting rules. **Every string here is final English copy — use it verbatim.**

**Contents**
1. Design tokens
2. Popup
3. Side panel shell
4. My Items tab
5. Timesheet tab
6. Options page
7. Formatting rules
8. States: loading, empty, error

---

## 1. Design tokens

Follows the Atlassian palette closely enough to feel native next to Jira, without copying their assets.

```css
:root {
  --bg:            #ffffff;
  --bg-subtle:     #f4f5f7;
  --border:        #dfe1e6;
  --text:          #172b4d;
  --text-subtle:   #6b778c;
  --accent:        #0052cc;
  --accent-hover:  #0065ff;
  --success:       #36b37e;
  --warning:       #ffab00;
  --danger:        #de350b;
  --radius:        3px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg:          #1d2125;
    --bg-subtle:   #22272b;
    --border:      #38414a;
    --text:        #b6c2cf;
    --text-subtle: #8c9bab;
    --accent:      #579dff;
  }
}
```

Status chips map from `statusCategory.key`, never from the status name:

| Category key | Background | Label colour |
|---|---|---|
| `new` | `--bg-subtle` | `--text-subtle` |
| `indeterminate` | `#deebff` | `--accent` |
| `done` | `#e3fcef` | `#006644` |

---

## 2. Popup

360 × 480, fixed. Deliberately minimal — it is a launcher, not a workspace.

**Connected state:**

```
┌──────────────────────────────────┐
│  Jira Timesheet Viewer      ⚙︎   │
│  Lucas Liachi · Connected        │
├──────────────────────────────────┤
│  Period                          │
│  ┌────────────────────────────┐  │
│  │ This week              ▾   │  │
│  └────────────────────────────┘  │
│  Jul 20 – Jul 26, 2026           │
├──────────────────────────────────┤
│  ┌────────────────────────────┐  │
│  │       My Items             │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │       Timesheet            │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

Period options, in order: `This week`, `Last week`, `This month`, `Last month`, `Custom…`. Selecting `Custom…` reveals two date inputs labelled `From` and `To`.

**Not connected state — the Connect form:**

The connection lives in `chrome.storage.session` (see `extension-arch.md` §5) — memory-only, cleared when the browser fully closes. So this form appears once per browser session (first use, or after a restart), not on every single use. It replaces the period/buttons area entirely — there is no separate "settings" detour for credentials:

```
┌──────────────────────────────────┐
│  Jira Timesheet Viewer      ⚙︎   │
│  Not connected                    │
├──────────────────────────────────┤
│  Jira base URL                    │
│  ┌────────────────────────────┐  │
│  │ https://your-domain...     │  │
│  └────────────────────────────┘  │
│  Email                            │
│  ┌────────────────────────────┐  │
│  │                            │  │
│  └────────────────────────────┘  │
│  API token                        │
│  ┌────────────────────────────┐  │
│  │ ••••••••••••••             │  │
│  └────────────────────────────┘  │
│  Kept in memory for this browser  │
│  session by default — never       │
│  written to disk unless you check │
│  the box below.                   │
│  ☐ Stay connected on this device  │
│  Encrypts the token with a key    │
│  that only exists in this browser │
│  profile — useless if copied      │
│  elsewhere, and erased on         │
│  Disconnect.                      │
│  ┌────────────────────────────┐  │
│  │          Connect           │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

Field labels and helper text: `Jira base URL` (placeholder `https://your-domain.atlassian.net`); `Email`; `API token` (password input, helper text `Create a token at id.atlassian.com under Security → API tokens.`); and, under the fields, the fixed disclosure line `Kept in memory for this browser session by default — never written to disk unless you check the box below.` in `--text-subtle`. That line is not optional copy — it's the one place the user is told that this form's data lives in session memory, not on disk, unless they opt into the checkbox below it.

Below that, a checkbox, **unchecked by default**: `Stay connected on this device`, with a helper line under it in `--text-subtle`: `Encrypts the token with a key that only exists in this browser profile — useless if copied elsewhere, and erased on Disconnect.` Checking it persists an encrypted copy of the token across browser restarts (see `extension-arch.md` §5a for the crypto — non-extractable WebCrypto key in IndexedDB, ciphertext in `chrome.storage.local`). This is opt-in, per connection, not a global setting — see the Non-negotiables changelog note (2026-07-24) in `SKILL.md`.

The inputs carry `autocomplete="url"` / `"username"` / `"current-password"` — deliberate, not filler. They're the standard hint for the user's own password manager (browser-native or third-party) to recognize this as a login form; see README.md "Usando um gerenciador de senhas" for what that does and doesn't make possible (third-party managers can't autofill *into* this form — one extension can't reach into another's page — so the documented path there is copy-paste from a saved vault entry). Don't remove these attributes as "unused."

The subtitle under the title is `{displayName} · Connected` once `CONNECT` succeeds, or `Not connected` in `--danger` before that. On success the form is replaced by the calendar + list (§3) for the rest of the browser session — surviving popup closes, panel reloads and service worker restarts alike, since it's backed by `chrome.storage.session`, not a variable that dies with the worker. Feedback messages: `Connected as {displayName}` in `--success`; `Could not connect. Check the URL, email and token.` in `--danger`, rendered inline above the `Connect` button.

A small `Disconnect` text link appears next to the subtitle only when connected — it clears `chrome.storage.session` immediately and returns to the Connect form.

---

## 3. Side panel shell — search, display, and what's logged per day

This tool searches assigned issues by date range and shows, per day in that range, which of them have a worklog and how many hours — plus a trailing list of everything with no worklog anywhere in the period. It has no "action" beyond opening an issue in Jira; it never creates or edits a worklog. The two-tab shell with a separate `Timesheet` tab, collapsible accordion, progress bars vs. a daily target, and an hour-based footer total that earlier drafts of this doc described are still parked in `plano-jira-timesheet-viewer.md` §11 — day-level worklog data itself is no longer parked (it was cut once, then reinstated the same day), but that richer presentation is. Don't build toward tabs/accordion/progress-bars without the user asking again.

### 3a. Shell (shipped)

```
┌────────────────────────────────────────────┐
│  Jira Timesheet Viewer     Lucas · Connected│
├────────────────────────────────────────────┤
│              ‹   July 2026   ›              │
│              Su Mo Tu We Th Fr Sa           │
│                        1  2  3  4          │
│               5  6  7  8  9 10 11          │
│              12 13 14 15 16 17 18          │
│              19 20▓21▓22▓23▓24▓25▓          │  ← 20–26 = picked range
│              26▓27 28 29 30 31              │
│  [ Projects (2) ▾ ]                         │
│  [ Status ▾ ]                               │
│  [ Type ▾ ]                                 │
│  [ Search by key or summary…        ]       │
│  [   Open summary in new tab        ]       │
├────────────────────────────────────────────┤
│  Grouped by day logged. Click an issue to   │
│  open it in Jira.                           │
│  Jul 14 · 2 items · 8.0h                    │
│    PROJ-1  Fix login redirect  In Progress  4.0h │
│    PROJ-2  Sprint planning     Em análise   4.0h │
│  Jul 15 · 3 items · 9.0h                    │
│    PROJ-1  Fix login redirect  In Progress  2.0h │
│    PROJ-2  Sprint planning     Em análise   4.0h │
│    PROJ-1  Fix login redirect  In Progress  1.0h │
│    PROJ-3  Other thing         Em análise   1.0h │
│  Jul 16 · No worklogs                       │
│  ...                                        │
│  Not logged in this period (3)              │
│    PROJ-9  Something else      To Do    —   │
└────────────────────────────────────────────┘
```

Jul 15 above shows `PROJ-1` twice, split apart by `PROJ-2` — that's deliberate, not a rendering bug: rows are one worklog each, ordered by the worklog's own timestamp across every issue that day, not grouped by issue. If `PROJ-1` logged at 9am and 4pm with `PROJ-2` logging at 1pm in between, that's exactly the order shown.

Click a start day, then an end day, on the calendar — that runs the search immediately. Clicking any day afterwards (inside or outside the picked range) starts a brand-new range rather than doing anything special with the existing one — the calendar itself has no per-day click behaviour; the day-by-day breakdown lives in the list, not in the calendar widget. This is implemented in `src/panel/calendar.js` (pure grid renderer) and `src/panel/panel.js` (state machine + list rendering) — read those before changing this interaction, not just this doc.

The list has one group per day in the picked range, oldest first, each showing **one row per worklog**, in the order it was logged (by the worklog's own timestamp, `started`) — not one row per issue. An issue with two worklogs on the same day gets two rows, and if another issue logged time in between those two timestamps, its row sits between them: the ordering crosses issues, it doesn't group by issue first. The same issue can also appear under several different days if it has worklogs on more than one. Days with nothing logged still render (`Jul 16 · No worklogs`) instead of disappearing — a missing day should be visible, not silently skipped. After all the days, one final group, `Not logged in this period ({n})`, lists every assigned issue with zero logged seconds across the whole range; its hours column shows `timetracking.originalEstimateSeconds` instead (there's nothing logged to show). Status names (`In Progress`, `Em análise` in the mockup above) come straight from Jira, in whatever language that instance uses — they are not strings this extension authors, so the "UI strings are English" rule doesn't apply to them.

If a worklog has a description, it appears on a second line below its row, in `--text-subtle`, italic, truncated with ellipsis (full text in `title` on hover). Since each row is already exactly one worklog, there's at most one description line per row — no merging, no loop; the previous design bundled every comment for an issue-day under one row, which is what made cross-issue chronological ordering (this section, above) impossible in the first place. Rows in the `Not logged in this period` group never have a description line (no worklog, nothing to show).

#### Project filter (below the calendar, above Status)

A button (`Projects`, or `Projects ({n})` once narrowed) that toggles a small checklist popover below it — see §3b for the shared component. It sits after the calendar because that reads better as a flow (pick the period, then narrow it), but it still changes the search itself, not just the display: `SEARCH`'s JQL gets `project IN (...)` when the user has unchecked at least one project, and changing the selection re-runs the search immediately if a range is already picked. The project list itself is fetched lazily (`GET_PROJECTS`), the first time this popover is opened — not eagerly when the panel loads. Unchecking every project is treated as "search nothing," not "no restriction" — the panel shows `Select at least one project to search.` and skips the network call entirely rather than sending a query that can't match anything.

While `GET_PROJECTS` is in flight, the button ignores further clicks (its own and an outside click both) instead of toggling the popover closed — otherwise a second click before the list arrives closes the popover right as the data lands, and it never gets shown until a third click. `emptyLabel` distinguishes three states: `Loading…` while the fetch is running, `Could not load projects: {message}` on failure (real error text, not a generic string — the first live bug report against this filter was exactly "no projects show up," so surfacing the real cause matters here), and `No projects found.` if it succeeded with zero results.

#### Status filter (below the project filter, replacing the old due-date checkbox)

Same button+popover pattern, labelled `Status`. Unlike the project filter, this is a **client-side sub-filter** over whatever `SEARCH` already returned — changing it never triggers a new network request. Its option list is rebuilt from the distinct `statusName` values in the current result set every time a new search comes back, and resets to "every status checked" each time — it does not remember a previous search's narrowing. Unchecking every status shows `Select at least one status to show items.` instead of an empty list, for the same reason as the project filter: distinguishing "nothing matches" from "you excluded everything."

#### Type filter (below Status, above the work item filter)

Same button+popover pattern, labelled `Type`. A client-side sub-filter over `issueType` (Jira's issue type name — `Task`, `Bug`, `Story`, etc.), exactly the same behaviour as the Status filter: option list rebuilt from the distinct `issueType` values in the current result set every time a new search comes back, resets to "every type checked" each time, and unchecking every type shows `Select at least one item type to show items.` instead of an empty list.

#### Work item filter (last, below Type)

A plain text input, not a checkbox popover — issues aren't a small enumerable set the way statuses or projects are. Placeholder `Search by key or summary…`, `aria-label="Search work items"`. Client-side only, same as the status and type filters: on every keystroke it further narrows `visibleItems` to those whose `key` or `summary` includes the query (case-insensitive substring match), applied after status and type. Empty query means no narrowing. There's no dedicated "no matches" message — same as the other client-side filters, a query that matches nothing just renders every day as `No worklogs` and an empty `Not logged in this period (0)` group, rather than a distinct empty state.

### 3b. Shared component: the multi-select filter popover

The Projects, Status and Type filters are the same `src/panel/multi-select.js` — a pure render function (same division of labour as `calendar.js`: it draws, `panel.js` owns all the state) for a button that toggles a small checklist below it. The work item filter is a plain text input, not this component — there's nothing to enumerate:

```
┌────────────────────┐
│ Status (2)      ▾  │
└────────────────────┘
┌────────────────────┐
│ ☑ Select all        │
├────────────────────┤
│ ☑ In Progress       │
│ ☐ Blocked           │
│ ☑ Done              │
└────────────────────┘
```

The button label is just the filter's name (`Projects`, `Status`) when everything is selected or the option list is still empty/loading; `{name} (n)` when narrowed to `n` of the total; `{name} (none)` when explicitly emptied. `Select all` is a real tri-state checkbox — checked when everything is selected, unchecked when nothing is, indeterminate in between — and toggling it sets every option to match in one action. Clicking outside the open popover closes it (see `SKILL.md` "Known traps" for why this needs `composedPath()`, not a plain containment check, given the popover re-renders itself on every click inside it).

Clicking a row opens `{baseUrl}/browse/{key}` by reusing the one tab this panel itself last opened for that purpose, updating its URL instead of creating a new tab each time — implemented as `openIssue()` in `panel.js`, tracking a single `issueTabId` for the panel's lifetime. It never touches a tab it didn't open itself (no querying/hijacking other open Jira tabs), and falls back to opening a fresh tab if the tracked one was closed.

If the panel is opened without an active connection (nothing in `chrome.storage.session` yet — first use of a browser session, or after Disconnect), the calendar/list area is replaced by the same Connect form described in §2 — do not redirect the user back to the popup, since a page cannot reliably reopen it. Reconnecting happens wherever the user currently is.

### 3c. Summary page (opened in a new tab)

`Open summary in new tab`, the last control after all three filters, disabled under the same conditions that keep the main list from rendering (no range picked yet, still loading, or a filter has blocked everything — see §8 "Empty" states). Clicking it doesn't search Jira again — it snapshots whatever's already computed for the current filters and opens `src/summary/summary.html` in a brand-new tab (always a new one, unlike issue rows which reuse a single tracked tab — a summary is a new document each time, not a repeat visit to the same resource):

```
┌──────────────────────────────────────────────────┐
│  Jira Worklog Summary                             │
│  Jul 20 – Jul 26, 2026                            │
│  Projects: PROJ1, PROJ2 · Status: In Progress     │
├──────────────────────────────────────────────────┤
│  JUL 14 · 2 ITEMS · 8.0H                          │
│    PROJ-1  Fix login redirect  In Progress  4.0h  │
│      Investigated the redirect loop               │
│    PROJ-2  Sprint planning     Em análise   4.0h  │
│  JUL 15 · 3 ITEMS · 9.0H                          │
│    PROJ-1  Fix login redirect  In Progress  4.0h  │
│    PROJ-2  Sprint planning     Em análise   4.0h  │
│    PROJ-3  Other thing         Em análise   1.0h  │
└──────────────────────────────────────────────────┘
```

Reuses the day-grouping layout from §3a (`item-group-header`, `item-row`, `status-chip`, `item-worklog-comment` classes) but as its own page with its own stylesheet (`src/summary/summary.css`), same convention as every other surface owning its own CSS — it doesn't link `panel.css`. Two deliberate differences from the live list:

- **No empty days, no "Not logged in this period."** This is a record of work actually done, not the panel's gap-finder — a day with nothing logged, or an issue with nothing logged, simply isn't in the report at all.
- **Not clickable.** Rows don't open Jira — this page is for reading, copying or printing, not for navigating onward.

The header line under the title only lists filters that are actually narrowing something (`Projects: …` only if fewer than all projects are checked, `Status: …` and `Type: …` likewise, `Search: "…"` only if the work item box isn't empty) — if none of the four are narrowed, that line is blank rather than reading "Projects: all of them."

Data moves from `panel.js` to the summary page through `chrome.storage.session` under the key `summaryPayload` — a one-shot handoff, not a persistent session like the connection (see `extension-arch.md` §5). `summary.js` reads it once on load and immediately clears the key, so opening the summary URL again later without going through the button shows `No summary data found.` instead of a stale report.

---

## 4. My Items — fuller table design (parked)

This section describes a richer, single flat table (sortable columns, a `Start` column, one `Logged` total per issue) — a different shape from what shipped in §3a, which groups by day instead of listing issues once each with a summed total. Worklog data itself is available now (`logsByDay` — see §3a, `extension-arch.md` §3), so a `Logged` column here is no longer blocked on missing data; it's just a different, not-yet-built presentation of the same data. Keep this as reference; don't build the sortable-flat-table version without checking with the user, since §3a's day-grouped view was the one actually asked for.

Columns, in order:

| Header | Content | Width |
|---|---|---|
| `Key` | issue key, links to `{baseUrl}/browse/{key}` | 90px |
| `Summary` | summary, truncated with ellipsis, full text in `title` | flexible |
| `Status` | status chip | 110px |
| `Start` | start date or `—` | 90px |
| `Due` | due date or `—` | 90px |
| `Est.` | original estimate in hours | 70px |
| `Logged` | time spent in hours | 70px |

Rows are grouped by status category in the order `indeterminate`, `new`, `done`, each group under a sticky header reading `In progress`, `To do`, `Done` with the count in parentheses: `In progress (4)`.

An issue whose due date has passed while its status category is not `done` gets a `--danger` left border and a red due date. Add `aria-label="Overdue"` — colour alone is not an accessible signal.

Clicking a row opens the issue in a new tab via `chrome.tabs.create`.

Sortable columns: `Key`, `Due`, `Logged`. Clicking a header toggles ascending/descending and shows a caret.

---

## 5. Timesheet tab (parked — out of scope)

Worklog data itself is no longer out of scope (see §3a) — what's described in this section specifically is: a separate tab, a collapsible accordion, progress bars against a daily-hours target, and the Planning sub-view (planned vs. logged). None of that is implemented, and none of it is the "next phase" — treat it as a design left on ice per `plano-jira-timesheet-viewer.md` §11, kept in case the user asks for it again, not a queue to work through.

An accordion, one section per day in the range, newest first. Days with no worklogs still render — an invisible gap reads as a loading bug, and the whole point is spotting missing entries.

```
┌────────────────────────────────────────────┐
│ ▾ Wed, Jul 22            7.5h / 8h  ███████│
│    PROJ-123  Fix login redirect      2.0h  │
│      Investigated the redirect loop        │
│    PROJ-456  Sprint planning         1.5h  │
│      —                                     │
│    PROJ-123  Fix login redirect      4.0h  │
│      Patched and deployed to staging       │
├────────────────────────────────────────────┤
│ ▸ Tue, Jul 21            8.0h / 8h  ███████│
├────────────────────────────────────────────┤
│ ▸ Mon, Jul 20            No worklogs       │
└────────────────────────────────────────────┘
```

Day header format: `{Weekday}, {Mon} {D}` — `Wed, Jul 22`.

The progress bar compares logged hours against the configured workday (default 8h):

- logged ≥ target → `--success`
- 0 < logged < target → `--warning`
- logged = 0 on a weekday → bar is empty, right side reads `No worklogs` in `--danger`
- weekend → bar is `--border`, target is 0, and no warning is shown

Worklog rows show key, summary and hours on one line; the worklog description sits on a second line in `--text-subtle`, or `—` when empty. Do not collapse duplicate entries for the same issue — two separate worklogs on the same day are two separate facts.

Today's section is expanded by default; all others start collapsed.

### Planning sub-view

Toggle labelled `Show planning`, above the accordion. When on, each day header gains `Planned: {n}h` alongside the logged total, and a summary block appears at the top:

```
┌────────────────────────────────────────────┐
│  Planned 40.0h  ·  Logged 38.5h  ·  −1.5h  │
└────────────────────────────────────────────┘
```

Planned hours come from `originalEstimateSeconds` spread evenly across working days between Start Date and Due Date. Label this as an estimate in a tooltip: `Estimate spread evenly across working days between start and due date.` Presenting a derived number as if Jira reported it is misleading.

---

## 6. Options page

There is deliberately no Connection section here — base URL, e-mail and API token are entered on the Connect form (§2) at the moment of use, never on a persistent settings screen. Options only holds things that are safe to keep on disk:

**Fields**
- `Start date field` — select populated from discovery, plus `Auto-detect` and `None`
- Button `Re-detect fields`

**Preferences**
- `Working hours per day` — number, default `8`
- `Time zone` — select, default from `myself.timeZone`
- `Cache duration (minutes)` — number, default `5`

**Data**
- Button `Clear cache`
- Button `Disconnect` — clears `chrome.storage.session` immediately and clears cached query results; only enabled while connected. Nothing about the connection is ever written to disk, so there's nothing to clear there.

A small status line at the top of the page reads `Connected as {displayName}` or `Not connected`, read-only — Options observes the connection, it doesn't create one.

---

## 7. Formatting rules

**Hours** — one decimal, always with the `h` suffix: `7.5h`, `0.5h`, `12.0h`. Convert with `(seconds / 3600).toFixed(1)`. Never show raw seconds or Jira's `2h 30m` string; a single unit keeps columns comparable at a glance.

**Dates in tables** — `MMM D` (`Jul 22`) when inside the current year, `MMM D, YYYY` otherwise.

**Empty values** — em dash `—`, in `--text-subtle`. Never blank, never `null`, never `N/A`.

**Totals** — per-day totals are shipped (each day header in §3a sums that day's `logsByDay[day].seconds` across items, formats once at the end — never sum pre-rounded hours). A grand total across the whole picked range is *not* shown anywhere (no footer) — not implemented, not asked for yet.

**CSV export** *(parked with §5 — not implemented)*: UTF-8 with BOM, headers `Date,Issue Key,Summary,Hours,Description`, every field quoted, internal quotes escaped by doubling.

---

## 8. States

**Loading** — a simple `Loading…` text is what's shipped. `SEARCH` does one worklog request per issue behind the scenes (see `extension-arch.md` §3), but there's no live progress reporting yet — skeleton rows and a progress port (`Loading worklogs… {loaded}/{total} issues`) would need the long-lived-port pattern in `extension-arch.md` §4, not built. Worth adding if a search over a big date range starts feeling slow with no feedback.

**Empty (My Items)** — `No issues assigned to you in this period.` (single line — that's what's shipped; a secondary hint suggesting widening the range or checking the filters would be a reasonable addition, not built yet).

**Empty (Timesheet)** *(parked with §5)* — `No worklogs found in this period.`

**Not connected** — no banner, no button: the Connect form (§2) itself, inline, on whichever surface is open. This is the expected state before the first `CONNECT` of a browser session, or right after Disconnect — not an error condition, and not something a service worker restart triggers anymore (the connection lives in `chrome.storage.session`, not in the worker).

**Error** — an inline banner in `--danger`, with a `Retry` button. Copy by status:

| Status | Message |
|---|---|
| 401 | `Authentication failed. Check your email and API token.` |
| 403 | `You don't have permission to view some of these issues.` |
| 404 | `Jira endpoint not found. Check the base URL.` |
| 429 | `Jira is rate limiting requests. Try again in a moment.` |
| network | `Could not reach Jira. Check your connection and the base URL.` |
| other | `Something went wrong: {message}` |

Never render the token, the auth header, or a raw stack trace in the UI.
