# Jira REST API reference

Everything the extension needs from Jira, and the parts that are easy to get wrong.

**Contents**
1. Authentication
2. Field mapping (native vs custom)
3. Start Date discovery
4. Search endpoint and pagination
5. JQL builders
6. Worklog retrieval
7. Rate limiting and concurrency
8. Cloud vs Data Center
9. Response shapes

---

## 1. Authentication

Basic Auth with an Atlassian API token. The header is built once, inside the service worker:

```javascript
// src/lib/jira-client.js
function authHeader(email, token) {
  // btoa is fine here: the string is ASCII (email + token)
  return `Basic ${btoa(`${email}:${token}`)}`;
}
```

Credentials come from the connection state set by the `CONNECT` message, held in `chrome.storage.session` (see `extension-arch.md` §3/§5) — never from `chrome.storage.local`, never from disk. They are never passed to a page context, never written to `console`, and never included in an error message that gets rendered.

`GET /rest/api/3/myself` is the connection test and the source of `accountId`, which is needed to filter worklogs by author.

```javascript
const me = await client.get('/rest/api/3/myself');
// me.accountId, me.displayName, me.emailAddress, me.timeZone
```

`me.timeZone` is worth reading — it's a better default than hardcoding `America/Sao_Paulo`.

---

## 2. Field mapping

| Concept | Field | Native? | Notes |
|---|---|---|---|
| Assignee | `assignee` | yes | JQL: `assignee = currentUser()` |
| Due date | `duedate` | yes | JQL: `duedate` |
| Start date | custom | **no** | see §3 |
| Status | `status` | yes | `status.name`, `status.statusCategory.key` |
| Issue type | `issuetype` | yes | `issuetype.name`, `.iconUrl` |
| Estimates | `timetracking` | yes | `originalEstimateSeconds`, `remainingEstimateSeconds` — `SEARCH` reads `originalEstimateSeconds` |
| Worklog hours | worklog `timeSpentSeconds` | yes | via worklog endpoint, see §6 — read and summed into `logsByDay[day].seconds` |
| Worklog date | worklog `started` | yes | ISO 8601 with offset — bucketed into a local day, see §6 |
| Worklog description | worklog `comment` | yes | **string in v2** (that's why v2, not v3 — see §6) — read into `logsByDay[day].comments`, shown under the item row when non-empty |

`statusCategory.key` is one of `new`, `indeterminate`, `done`. Use it for colour coding and for the "overdue" rule — comparing against the literal status name breaks on any workflow customization.

---

## 3. Start Date discovery

```javascript
// src/lib/fields.js
const CANDIDATE_NAMES = ['start date', 'target start', 'data de início', 'data início'];

export async function resolveStartDateField(client, { force = false } = {}) {
  if (!force) {
    const { startDateFieldId } = await chrome.storage.local.get('startDateFieldId');
    if (startDateFieldId !== undefined) return startDateFieldId;
  }

  const fields = await client.get('/rest/api/3/field');

  const candidates = fields.filter(f =>
    f.custom &&
    f.schema?.type === 'date' &&
    CANDIDATE_NAMES.includes(String(f.name).trim().toLowerCase())
  );

  const id = candidates[0]?.id ?? null;
  await chrome.storage.local.set({ startDateFieldId: id, startDateCandidates: candidates });
  return id; // e.g. "customfield_10015", or null if not present
}
```

Surface `startDateCandidates` in Options as a dropdown so the user can correct the guess. Store `null` deliberately when nothing matches — that distinguishes "no such field on this instance" from "not looked up yet", and stops the lookup running on every query.

The JQL name for a custom field is the field name in quotes (`"Start Date" >= "2026-07-01"`) or `cf[10015]`. The `customfield_10015` form works in the `fields` array of a search body but not in JQL.

---

## 4. Search endpoint and pagination

`POST /rest/api/3/search/jql`. The older `GET /rest/api/3/search` is deprecated. Pagination is token-based, not offset-based:

```javascript
// src/lib/jira-client.js
export async function searchAll(client, { jql, fields, pageSize = 100, onProgress }) {
  const issues = [];
  let nextPageToken;

  do {
    const body = { jql, fields, maxResults: pageSize };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const data = await client.post('/rest/api/3/search/jql', body);
    issues.push(...(data.issues ?? []));
    nextPageToken = data.nextPageToken;

    onProgress?.({ loaded: issues.length });
  } while (nextPageToken);

  return issues;
}
```

There is no reliable `total` on this endpoint — drive the loop off `nextPageToken` alone. Request only the fields the UI renders; the payload grows fast otherwise.

```javascript
const fields = [
  'summary', 'status', 'issuetype', 'priority',
  'duedate', 'timetracking', 'parent',
  startDateFieldId,          // may be null
].filter(Boolean);
```

---

## 5. JQL builders

Two independent builders in `src/lib/jql.js`, one per search area. Start Date narrowing is not implemented in either (§3 describes the discovery mechanism for if it ever is).

**My Items** — always includes issues with no due date (no toggle for this); narrowing beyond project happens through the status/type/work-item client-side filters instead.

```javascript
// src/lib/jql.js

/**
 * Issues assigned to the user, active inside [from, to]. Always includes
 * issues with no due date — there is no toggle for this. `projectKeys`
 * narrows to specific projects when the user's picked a subset in the
 * project filter; empty means no restriction (every project).
 */
export function buildMyItemsJql({ from, to, projectKeys = [] }) {
  const clauses = ['assignee = currentUser()'];

  if (projectKeys.length > 0) {
    const list = projectKeys.map((key) => `"${key}"`).join(', ');
    clauses.push(`project IN (${list})`);
  }

  clauses.push(`((duedate >= "${from}" AND duedate <= "${to}") OR duedate IS EMPTY)`);

  return `${clauses.join(' AND ')} ORDER BY duedate ASC, priority DESC`;
}
```

**Timesheet** — finds issues with at least one worklog by the current user inside the range, independent of assignment or due date. `worklogDate` uses an exclusive upper bound (`< nextDay`) to cleanly include the whole end day.

```javascript
// src/lib/jql.js
export function buildWorklogJql({ from, to }) {
  const clauses = ['worklogAuthor = currentUser()'];
  const nextDay = addDays(to, 1);
  clauses.push(`worklogDate >= "${from}" AND worklogDate < "${nextDay}"`);
  return `${clauses.join(' AND ')} ORDER BY updated DESC`;
}
```

Dates are `YYYY-MM-DD` strings. `projectKeys` come from `GET_PROJECTS` results the user checked in the project filter popover — they're Jira project keys (alphanumeric, no user-typed free text), so simple double-quoting is safe here. Never build JQL from actual raw user text without escaping quotes and backslashes — that rule still applies the moment any free-text search box is added; date pickers, calendar clicks and checkbox-driven values (like `projectKeys`) are not that.

---

## 6. Worklog retrieval

Called from both `SEARCH` (My Items) and the Timesheet search in `service-worker.js`, once per issue (via `mapWithLimit`, concurrency 5) — see `extension-arch.md` §3.

Use **v2** for worklogs. v3 returns `comment` as an ADF tree; v2 returns a plain string, which the current code reads directly into `logsByDay[day].comments` — that's why v2, not v3.

```javascript
// src/lib/jira-client.js
export async function fetchIssueWorklogs(client, issueId, fromMs, toMs) {
  const out = [];
  let startAt = 0;

  while (true) {
    const params = new URLSearchParams({
      startAt: String(startAt),
      maxResults: '100',
      startedAfter: String(fromMs),   // epoch ms, server-side filter
      startedBefore: String(toMs),
    });

    // v2 on purpose: v3 returns `comment` as ADF. Do not "upgrade" this.
    const data = await client.get(`/rest/api/2/issue/${issueId}/worklog?${params}`);
    const batch = data.worklogs ?? [];
    out.push(...batch);

    startAt += batch.length;
    if (batch.length === 0 || startAt >= (data.total ?? 0)) break;
  }

  return out;
}
```

`startedAfter` / `startedBefore` are exclusive bounds. Build them from local midnight of `from` and the end of `to`:

```javascript
// src/lib/dates.js
export function dayBoundsMs(fromISO, toISO, timeZone) {
  const startMs = zonedDayStart(fromISO, timeZone).getTime() - 1;
  const endMs   = zonedDayStart(toISO,   timeZone).getTime() + 24 * 3600 * 1000;
  return { startMs, endMs };
}
```

Then filter by author — the endpoint returns everyone's worklogs:

```javascript
const mine = worklogs.filter(w => w.author?.accountId === myAccountId);
```

Bucket into a per-day `{ seconds, comments }` shape — this is `logsByDay` in the `SEARCH` response (see `extension-arch.md` §3):

```javascript
const logsByDay = {};
for (const wl of mine) {
  if (!wl.started) continue;
  const day = isoDateInTimeZone(Date.parse(wl.started), timeZone);
  const entry = logsByDay[day] ?? { seconds: 0, comments: [] };
  entry.seconds += wl.timeSpentSeconds ?? 0;
  const comment = typeof wl.comment === 'string' ? wl.comment.trim() : '';
  if (comment) entry.comments.push(comment);
  logsByDay[day] = entry;
}
```

`comments` is an array, not a single string, because more than one worklog can land on the same issue on the same day with different descriptions — don't collapse them into one, each is a separate fact (same principle as the parked accordion design in `ui-spec.md` §5).

### If ADF handling becomes necessary

Should a future feature need the v3 comment, flatten it rather than rendering it:

```javascript
// src/lib/adf.js
export function adfToText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  const children = (node.content ?? []).map(adfToText).join('');
  return node.type === 'paragraph' ? `${children}\n` : children;
}
```

---

## 7. Rate limiting and concurrency

Jira Cloud returns **429** with a `Retry-After` header. Honour it, then fall back to exponential backoff:

```javascript
async function requestWithRetry(doFetch, { maxAttempts = 4 } = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await doFetch();
    if (res.status !== 429 || attempt === maxAttempts) return res;

    const retryAfter = Number(res.headers.get('Retry-After'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(2 ** attempt * 500, 8000);

    await new Promise(r => setTimeout(r, waitMs));
  }
}
```

Worklogs are fetched one request per issue, so parallelise with a cap. Five concurrent requests is comfortable; higher reliably trips the limiter on a busy account.

```javascript
export async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await fn(items[i], i);
      }
    }
  );

  await Promise.all(workers);
  return results;
}
```

---

## 8. Cloud vs Data Center

```javascript
const info = await client.get('/rest/api/3/serverInfo');
const isCloud = info.deploymentType === 'Cloud';
```

On Server/Data Center, `POST /rest/api/3/search/jql` does not exist. Fall back to `GET /rest/api/2/search` with `startAt` / `maxResults` / `total` offset pagination. Detect once at setup and cache the result.

---

## 9. Response shapes

Issue from search:

```json
{
  "id": "10234",
  "key": "PROJ-123",
  "fields": {
    "summary": "Fix login redirect",
    "status": { "name": "In Progress", "statusCategory": { "key": "indeterminate" } },
    "issuetype": { "name": "Bug", "iconUrl": "https://..." },
    "duedate": "2026-07-31",
    "customfield_10015": "2026-07-20",
    "timetracking": {
      "originalEstimateSeconds": 28800,
      "remainingEstimateSeconds": 14400
    }
  }
}
```

Worklog (v2):

```json
{
  "id": "45678",
  "issueId": "10234",
  "author": { "accountId": "712020:...", "displayName": "Lucas" },
  "comment": "Investigated the redirect loop",
  "started": "2026-07-22T08:00:00.000-0300",
  "timeSpentSeconds": 7200
}
```

`timetracking` is absent entirely when time tracking is disabled on the project — treat missing as zero rather than letting `undefined` reach the formatter.

---

## 10. Project listing (for the project filter)

`GET /rest/api/3/project/search` — paginated (`startAt`/`maxResults`/`isLast`, same shape family as everything else here), returns projects the connected account can see:

```javascript
// src/lib/jira-client.js
export async function fetchAllProjects(client) {
  const projects = [];
  let startAt = 0;
  while (true) {
    const params = new URLSearchParams({ startAt: String(startAt), maxResults: '50', orderBy: 'name' });
    const data = await client.get(`/rest/api/3/project/search?${params}`);
    const batch = data.values ?? [];
    projects.push(...batch.map((p) => ({ key: p.key, name: p.name })));
    startAt += batch.length;
    if (batch.length === 0 || data.isLast || startAt >= (data.total ?? 0)) break;
  }
  return projects;
}
```

Only `key` and `name` are kept — nothing else in the `project.search` response is used. Called once, lazily, from the `GET_PROJECTS` message handler (see `extension-arch.md` §3), the first time the panel's project filter popover is opened — not on every `SEARCH`, and not eagerly on connect.
