---
name: jira-timesheet-viewer
description: Builds and evolves "Jira Timesheet Viewer" v1.0.0 — a read-only Manifest V3 Chrome/Edge extension with two independent search areas. Timesheet searches by date range only and groups worklogs by day, one row per worklog ordered chronologically across issues. My Items searches by date range narrowed by a project filter in the JQL, plus client-side sub-filters for status, issue type, and a free-text work item search, also grouped by day, with a trailing list of issues with no worklog in the period. Both include the worklog description when present and a button that opens a read-only summary of the day-grouped, logged-only results in a new tab. The connection can optionally persist encrypted across browser restarts if the user opts into "Stay connected on this device". Covers scaffolding, the Jira REST client (auth, nextPageToken pagination, 429 retry, per-issue worklog fetch, project listing), JQL builders for both search areas, the popup + side panel UI (including the button+popover multi-select filter pattern, the plain-text work item filter, and the new-tab summary page). Use this skill ALWAYS when the user mentions building, debugging or extending a Chrome/Edge extension that talks to Jira — including phrases like "plugin do Jira", "extensão do Jira", "timesheet extension", "worklog", "apontamento", "filtro de status", "filtro de projeto", "filtro de work item", "filtro de tipo", "resumo", "summary", "My Items", "manifest v3 jira", "jira-client.js". Also use when they ask to search/read due dates, statuses, estimates or worklogs from a browser extension, even if they never say the words "Chrome extension". Planning (planned vs. logged), an hours-vs-target progress bar, a collapsible accordion/tabs and CSV export are permanently out of scope by the user's own request — don't add those without the user asking again.
---

# Jira Timesheet Viewer

Build a **read-only** MV3 browser extension that answers: **which issues are assigned to me inside a date window, what have I logged on each day, and what haven't I logged at all?**

Nothing in this extension creates or edits Jira issues or worklogs — it only reads them. Clicking an issue opens its normal Jira page in a new tab, where the user logs time exactly as they always have; that's the only write path, and it happens entirely outside the extension.

---

## Non-negotiables

These exist because breaking them causes real damage, not because they're stylistic preferences.

**Credentials never appear in source.** No API token, e-mail or account ID in any committed file, example, docstring or test fixture. If the user pastes a real token into the conversation, stop and tell them to revoke it at `id.atlassian.com → Security → API tokens` before continuing.

**Corporate connection data never touches disk, by default.** Jira base URL, e-mail and API token are entered on screen and kept in `chrome.storage.session` — the browser's memory-only storage area, cleared when the browser fully closes, never written to disk unless the user opts in (see below). `.session` survives an MV3 service-worker restart (the worker gets killed after ~30s idle), while still never touching disk — that's the balance the extension is built around. Only non-connection preferences (workday hours) persist in `chrome.storage.local` unconditionally.

**Opt-in persisted connection.** An unchecked-by-default checkbox on the connect form, "Stay connected on this device": when checked, `CONNECT` encrypts the token (AES-GCM, `extractable: false` key held as a `CryptoKey` in the service worker's IndexedDB — `src/lib/secure-store.js`) and writes only the ciphertext to `chrome.storage.local` (`persistedConnection`); the plaintext token itself never touches `chrome.storage.local` or disk in any form. `DISCONNECT` deletes both the stored ciphertext and the IndexedDB key (crypto-erase). Be honest about the limit if asked: `extractable: false` stops the key from being exported via script, but doesn't defend against someone with filesystem access to the *whole* Chrome profile copied elsewhere — the protection is roughly equivalent to Chrome's own saved-password store, not unbreakable encryption. Don't re-loosen this further (e.g. make it default-on, or drop the encryption) without the user asking again — see `extension-arch.md` §5a for the full design.

**The token never crosses into a page context.** Popup and side panel never hold the token themselves — they collect it on the connect form and hand it to the service worker in one message; the service worker is the only place that keeps it, and only for the current request/session. A page script that can read the token is one XSS away from leaking it.

**All user-facing strings are English.** Buttons, labels, tooltips, empty states, error text, CSV headers. The conversation with the user may be in Portuguese — the artifact is not.

**Read-only means read-only.** Only `GET` (including `GET .../worklog`) and the `POST /rest/api/3/search/jql` used for querying. Any `POST /worklog`, `PUT /issue` or `DELETE` is out of scope unless the user explicitly asks to expand the scope, and then it needs its own confirmation step in the UI. Reading worklogs is in scope; writing one never is by default.

---

## Project layout

```
jira-timesheet-viewer/
├── manifest.json
├── src/
│   ├── background/service-worker.js   # only place that holds credentials; owns CONNECT/SEARCH
│   ├── lib/
│   │   ├── jira-client.js             # fetch, auth, pagination, 429 retry, searchAll, mapWithLimit, fetchIssueWorklogs, fetchAllProjects
│   │   ├── jql.js                     # buildMyItemsJql (assignee + optional project IN (...) + due-date-or-empty) and buildWorklogJql (worklogAuthor + worklogDate range)
│   │   ├── dates.js                   # ISO ↔ epoch ms, timezone-safe day bucketing, enumerateDates
│   │   ├── messaging.js               # typed request/response wrapper
│   │   ├── settings.js                # workday hours preference only — not yet consumed by any view
│   │   ├── connect-form.js            # shared Connect form, used by both popup and panel
│   │   └── secure-store.js            # encrypt/decrypt for the opt-in persisted connection — non-extractable key in IndexedDB, service worker only
│   ├── popup/                         # launcher: Connect form (if needed) + "Open My Items"
│   ├── panel/                         # calendar.js (grid, week starts Sunday) + multi-select.js (project/status/type filter popover) + panel.js (Timesheet + My Items state, day-grouped lists, work item text filter, summary handoff) — see ui-spec.md §3a
│   ├── options/                       # workday hours preference — no credentials here
│   ├── summary/                       # summary.html/css/js — read-only day-grouped report opened in a new tab, fed via chrome.storage.session
│   └── welcome/                       # onboarding page opened on install (chrome.runtime.onInstalled)
└── icons/                             # 16, 32, 48, 128
```

Run `python scripts/scaffold.py <target-dir>` to generate this tree with working stubs, then build it out feature by feature. The scaffold is a starting point, not a finished product — expect to rewrite most of it. **The scaffold never writes `.gitignore`** — don't add it back to `FILES` in `scripts/scaffold.py`; it clobbered a real project's `.gitignore` once already (see that file's own comment).

---

## What's shipped (v1.0.0)

- **Connect form** (popup + side panel) — sends `CONNECT`, stores the connection in `chrome.storage.session` by default (never disk, unless "Stay connected on this device" is checked — see Non-negotiables and `extension-arch.md` §5a), prints `displayName` from `GET /rest/api/3/myself`.
- **`jira-client.js`** — paginated `searchAll`, 429 retry with backoff, per-issue worklog fetch, project listing.
- **Timesheet** — search by date range only, grouped by day, one row per worklog ordered chronologically across issues (not one block per issue), worklog description shown when present.
- **My Items** — Sunday-first calendar range picker, project multi-select (narrows the JQL, sits below the calendar), status multi-select (client-side, post-search), issue type multi-select (client-side, post-status), work item text filter (client-side, matches key/summary), list grouped by day, trailing "not logged in this period" section.
- **`Open summary in new tab`** — renders the same day grouping (logged items only, no empty days) on its own page (`src/summary/`), fed via a one-shot `chrome.storage.session` handoff, no new search. See `ui-spec.md` §3a/§3c.
- Click-through to `/browse/{key}` is the only "action" the live list offers; the summary page isn't clickable.

Not implemented, and not planned unless the user asks again: Start Date discovery, query caching, Planning (planned vs. logged), an hours-vs-target progress bar, a collapsible accordion/tabs, CSV export. See `CLAUDE.md` → "O que está fora de escopo".

When resuming work, check what already exists on disk before writing anything — regenerating files silently discards edits.

---

## Working method

**Read the reference before writing the code it covers.** The three reference files hold the details that are easy to get subtly wrong:

- `references/jira-api.md` — endpoints, JQL builders, pagination, worklog server-side date filtering, field mapping (which fields are native and which are not), ADF, rate limiting. Read this before touching anything under `src/lib/`.
- `references/extension-arch.md` — MV3 service worker lifecycle, messaging protocol, storage strategy, side panel wiring, CSP. Read this before touching `manifest.json`, `background/` or wiring a new UI surface.
- `references/ui-spec.md` — layout of both surfaces, the exact English strings, formatting rules for hours and dates. Read this before writing any HTML or CSS.

**Ship vanilla JS with ES modules.** No build step. The user should be able to hit `chrome://extensions → Load unpacked` and see the change. Introduce Vite + React only if the user explicitly asks for it or the UI genuinely outgrows plain DOM — and say so out loud rather than doing it silently.

**Prefer server-side filtering over client-side discarding.** Request only the `fields` the UI actually renders in the search body — the payload grows fast otherwise. Same instinct for worklogs: `fetchIssueWorklogs` filters by `startedAfter`/`startedBefore` in the request itself (documented in `jira-api.md` §6) rather than fetching an issue's whole worklog history and discarding what's outside the range client-side.

**Every network path needs a visible failure state.** 401 → "Authentication failed. Check your e-mail and API token." 403 → "You don't have permission to view this issue." 429 → retry with backoff, and if it still fails, "Jira is rate limiting requests. Try again in a moment." "Not connected" is not an error — it's the expected state before the first `CONNECT` of a browser session (or after the user clicks Disconnect), and it routes straight to the Connect form, not to a generic error banner. A service worker restart is *not* one of these cases anymore — the connection is reloaded from `chrome.storage.session` transparently. A spinner that never resolves is the worst possible outcome.

---

## Known traps

These come up on nearly every build. Handling them upfront saves a debugging session.

**Timezone drift.** Worklog `started` carries an offset. Bucketing by day with `new Date(started).toISOString().slice(0,10)` shifts evening entries into the next day. `service-worker.js` uses `isoDateInTimeZone` (from `dates.js`, using the connected account's `timeZone`, not a hardcoded one) to build `logsByDay` — nothing else should slice ISO strings by hand, for worklog dates or `due` dates.

**Start Date is not a native field.** It's a custom field whose ID varies per Jira instance. Not implemented today (out of scope, see `CLAUDE.md`) — if it's ever built, discover it at runtime by matching on name and `schema.type === 'date'`, cache the ID, and let Options override it. Hardcoding `customfield_10015` works on one instance and silently breaks on the next.

**The service worker dies.** MV3 terminates it after roughly 30 seconds idle. A long multi-page query answered through a single `sendMessage` round trip will drop. Use a long-lived `chrome.runtime.connect` port and stream progress. The connection itself survives this (it's reloaded from `chrome.storage.session` on the next message — see Non-negotiables); this trap is now only about in-flight requests and any *other* module-level state you might be tempted to add.

**`duedate IS EMPTY` is common.** Many issues have no due date. `buildMyItemsJql` always includes them (`OR duedate IS EMPTY`) — there is no toggle for this; narrowing happens through the status/type/work-item filters instead. Don't bring back a checkbox for it without the user asking first.

**Cloud and Data Center differ.** `POST /rest/api/3/search/jql` doesn't exist on Server/Data Center. Detect deployment with `GET /rest/api/3/serverInfo` and fall back to `/rest/api/2/search` with `startAt` pagination.

**Closing a popover on outside click, when the click that opened it re-renders the DOM.** `multi-select.js`'s button/checkbox handlers call `container.innerHTML = ''` and rebuild on every state change — including the very click that opened the popover. A `document` click listener that checks `containerEl.contains(e.target)` will wrongly think that click was "outside," because by the time the listener runs, `e.target` (the original button/checkbox) has already been detached and replaced. Use `e.composedPath().includes(containerEl)` instead — it's computed at dispatch time, before the re-render, and `containerEl` itself (the stable, never-replaced wrapper div) is still in that captured path regardless of what happened to its children afterward.

**An empty result from a lazy fetch is not the same as the user emptying a filter.** After `GET_PROJECTS` resolves, don't do `new Set(projectOptions.map(...))` unconditionally — if the account genuinely has zero visible projects (or the account/endpoint hiccups), `projectOptions` is `[]` and that produces an empty-but-non-null `Set`. `runSearch()`/`renderList()` treat "`selectedProjects` is a non-null empty Set" as "the user explicitly unchecked every project," which skips the network call entirely and shows `Select at least one project to search.` — for *every* date range afterward, with no way out, since there are no checkboxes to re-check. This hit a real user: the project filter came back empty, and as a direct consequence the date-range search stopped returning anything at all. The fix is to only build the Set when `projectOptions.length > 0`; otherwise leave `selectedProjects` `null` (= "nothing to restrict by," same as never having opened the filter).

**A non-extractable WebCrypto key lives in IndexedDB, not `chrome.storage`.** `secure-store.js`'s AES-GCM key is generated with `extractable: false` and stored as a `CryptoKey` object in the service worker's own IndexedDB (`jtv-keystore`) — it cannot be serialized into `chrome.storage.local`/`.session` at all (structured clone of a non-extractable key across that boundary isn't how this works; IndexedDB is the only place a `CryptoKey` can actually persist here). If `persistedConnection`'s ciphertext in `chrome.storage.local` is ever present without a matching IndexedDB entry (user cleared site data selectively, or the two calls raced), decryption throws — `loadConnection()` catches that and falls back to "not connected," not a hard error; don't "fix" that catch block by trying to recover the key, there's nothing to recover it from.

**A toggle-open handler that lazily fetches data must not let a click close it mid-fetch.** This bit the project filter for real: `handleProjectToggleOpen` toggles `projectFilterOpen` and, on first open, awaits `GET_PROJECTS`. A second click on the button (or an incidental outside click) while that request is still in flight flips the popover closed again; when the fetch resolves, `projectFilterOpen` is `false`, so the freshly loaded options never render — from the outside this looks exactly like "the filter is broken," even though the data arrived fine. Guard both the toggle handler and the outside-click closer with `if (state.projectsLoading) return` / `!state.projectsLoading &&` so a click can't close a popover whose data hasn't landed yet. Also make sure `projectsLoading` is set to `true` *before* the first render after opening, not after — otherwise there's a one-frame flash of the wrong empty-state message.

---

## Verification

Before telling the user a change is done, confirm it actually loads:

```bash
# no syntax errors across the source tree
find src -name '*.js' -exec node --check {} \;

# manifest is valid JSON and declares the expected surfaces
python -c "import json;m=json.load(open('manifest.json'));print(m['manifest_version'], list(m))"

# nothing that looks like a leaked credential
grep -rniE 'ATATT|api[_-]?token\s*[:=]\s*["'\''][^"'\'']{12,}' src manifest.json || echo "clean"
```

Then have the user load it unpacked and exercise the one thing the phase added. Report what you verified mechanically versus what still needs their eyes — overstating what's been tested is worse than admitting the gap.

---

## Communication

The user works in Portuguese; write explanations, summaries and questions in Portuguese. Code, comments, commit messages, filenames and every UI string stay in English. When a decision has a real tradeoff — Basic Auth vs OAuth, popup vs side panel, vanilla vs framework — present the tradeoff and let the user choose rather than picking silently.
