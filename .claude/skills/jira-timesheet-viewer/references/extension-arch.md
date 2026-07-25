# Manifest V3 architecture reference

MV3-specific mechanics for this extension.

**Contents**
1. manifest.json
2. Service worker lifecycle
3. Messaging protocol
4. Streaming long queries over a port
5. Storage strategy
6. Side panel wiring
7. CSP and module loading
8. Loading and debugging

---

## 1. manifest.json

```json
{
  "manifest_version": 3,
  "name": "Jira Timesheet Viewer",
  "version": "0.1.0",
  "description": "Search and view your assigned Jira issues in a date range.",
  "permissions": ["storage", "sidePanel", "alarms"],
  "host_permissions": ["https://*.atlassian.net/*"],
  "background": {
    "service_worker": "src/background/service-worker.js",
    "type": "module"
  },
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_icon": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
  },
  "side_panel": { "default_path": "src/panel/panel.html" },
  "options_page": "src/options/options.html",
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
}
```

This manifest lists `alarms` because a future cache-refresh phase (Phase 4 in the current plan, `plano-jira-timesheet-viewer.md` §8) might need it. **What's actually shipped does not use `chrome.alarms` anywhere and does not declare it** — an unused permission is exactly what the Chrome Web Store's "narrowest permissions necessary" policy flags in review (see `CLAUDE.md`). Add `alarms` back to `manifest.json` only in the same change that starts calling `chrome.alarms`, not before.

`host_permissions` is what lets the service worker bypass CORS. Without it, every request fails with an opaque network error rather than a useful message.

For a self-hosted Jira, add the specific origin (`https://jira.company.com/*`). Prefer adding known origins over `<all_urls>` — a broad host permission makes the extension look dangerous in the store review and in `chrome://extensions`.

No `content_scripts`. The extension never injects into pages, which keeps the permission surface small.

Not every page needs a manifest entry — only the special surfaces above (`action`, `side_panel`, `options_page`, `background`) do. A plain page like `welcome/welcome.html` or `summary/summary.html` is opened with `chrome.tabs.create({ url: chrome.runtime.getURL('src/summary/summary.html') })` from another extension context (the service worker for `welcome.html`, the panel for `summary.html`) and needs nothing declared — this only works because the caller is itself an extension page/worker with the right privileges, not a content script or a normal web page.

---

## 2. Service worker lifecycle

The worker is terminated after roughly 30 seconds of inactivity and restarted on the next event. Consequences:

**Module-level state does not survive.** Cache derived data in `chrome.storage`, not in a top-level `let`. A module-level variable is a legitimate in-memory cache only if losing it is harmless — which is exactly why the current connection (base URL, e-mail, token) lives in one: losing it on teardown is the desired behaviour, not a defect. See §5.

**Set listeners synchronously at the top level.** Registering `chrome.runtime.onMessage` inside a promise callback means the listener may not exist when the worker is revived for that exact event.

```javascript
// src/background/service-worker.js
import { handleMessage } from './router.js';

// top level, synchronous — do not wrap in an async IIFE
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch(err =>
    sendResponse({ ok: false, error: serializeError(err) })
  );
  return true; // keeps the channel open for the async response
});
```

Returning `true` is required for async responses. Forgetting it produces a silent undefined response, which is a genuinely annoying bug to track down.

---

## 3. Messaging protocol

One shape for every request and response makes error handling uniform:

```javascript
// src/lib/messaging.js
export async function request(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, payload });
  if (!res?.ok) throw Object.assign(new Error(res?.error?.message ?? 'Unknown error'), res?.error);
  return res.data;
}
```

Message types used by the extension:

| Type | Payload | Returns | Status |
|---|---|---|---|
| `CONNECT` | `{ baseUrl, email, token }` | `{ displayName, accountId, timeZone }` | shipped |
| `GET_CONNECTION_STATUS` | — | `{ connected, displayName?, accountId?, baseUrl?, timeZone? }` | shipped |
| `DISCONNECT` | — | `{ disconnected: true }` | shipped |
| `SEARCH` | `{ from, to, projectKeys }` | `{ from, to, baseUrl, issues: Issue[] }` — `key, summary, statusName, statusCategory, due, estimateSeconds, logsByDay` per issue, where `logsByDay` is `{ 'YYYY-MM-DD': { seconds, comments: string[] } }` for the user's own worklogs in `[from, to]` | shipped |
| `GET_PROJECTS` | — | `{ projects: [{ key, name }] }` | shipped |
| `RESOLVE_START_FIELD` | `{ force }` | `{ id, candidates }` | future — Phase 3, optional |
| `CLEAR_CACHE` | — | `{ cleared: true }` | future — Phase 4 |

`SEARCH` does one paginated `searchAll` call for the issue list (JQL narrowed by `projectKeys` when non-empty — see `jira-api.md` §5), then one `fetchIssueWorklogs` call per issue (via `mapWithLimit`, concurrency 5) to build `logsByDay`, summing `timeSpentSeconds` and collecting non-empty `comment` strings per day. This was cut from scope at one point and reinstated the same day at the user's request (see `plano-jira-timesheet-viewer.md` §11 for the full timeline) — the panel derives its entire day-grouped view, the worklog descriptions, and the "not logged" list from this one response; it never asks the service worker again per day. Status filtering happens entirely in the panel, over this same response — there's no message for it.

`GET_PROJECTS` is called lazily, once, the first time the user opens the project filter popover — not eagerly on connect. The panel caches the result in memory for the rest of that panel session.

`CONNECT` is the only message that carries credentials, and it only ever travels popup → service worker, once, right after the user submits the inline Connect form. The service worker writes `{ baseUrl, email, token, accountId, displayName, timeZone }` to `chrome.storage.session` and caches it in a module-level variable for fast reads within the current worker lifetime. It answers `SEARCH` with a `NOT_CONNECTED` error (surfaced as the Connect form, not a red error banner) only when `chrome.storage.session` itself has nothing — i.e. before the first `CONNECT` of a browser session, or after `DISCONNECT`. A service worker restart no longer triggers this: the module-level cache is empty, but `loadConnection()` transparently reloads from `chrome.storage.session` on the next message. See §5.

Errors are serialised, never thrown raw across the boundary — an `Error` does not survive structured cloning intact:

```javascript
function serializeError(err) {
  return { message: err.message, status: err.status ?? null, code: err.code ?? null };
}
```

---

## 4. Streaming long queries over a port

A timesheet spanning a month can mean dozens of worklog requests. A single `sendMessage` round trip risks the worker being torn down mid-flight, and gives the user no feedback. Use a long-lived port:

```javascript
// panel side
const port = chrome.runtime.connect({ name: 'timesheet' });
port.postMessage({ type: 'GET_TIMESHEET', payload: { from, to } });
port.onMessage.addListener(msg => {
  if (msg.type === 'progress') renderProgress(msg.loaded, msg.total);
  if (msg.type === 'done') renderTimesheet(msg.data);
  if (msg.type === 'error') renderError(msg.error);
});
```

```javascript
// worker side
chrome.runtime.onConnect.addListener(port => {
  port.onMessage.addListener(async msg => {
    try {
      const data = await buildTimesheet(msg.payload, {
        onProgress: (loaded, total) => port.postMessage({ type: 'progress', loaded, total }),
      });
      port.postMessage({ type: 'done', data });
    } catch (err) {
      port.postMessage({ type: 'error', error: serializeError(err) });
    }
  });
});
```

An open port keeps the worker alive while the query runs, which is exactly what's needed here.

---

## 5. Storage strategy

| Data | Area | Why |
|---|---|---|
| Jira base URL, e-mail, API token, `accountId`, `displayName`, `timeZone` | `chrome.storage.session`, cached in a module-level variable | corporate connection data — memory-only, cleared when the browser fully closes, never written to disk. The module-level cache avoids an `await chrome.storage.session.get(...)` on every single request within one worker lifetime |
| `persistedConnection` (`{ baseUrl, email, accountId, displayName, timeZone, tokenCiphertext }`) | `chrome.storage.local`, **opt-in only** | written only when the user checks "Stay connected on this device" on the connect form. `tokenCiphertext` (`{ iv, ciphertext }`, both base64) is the *only* form the token takes here — never plaintext. Encrypted/decrypted by `../lib/secure-store.js` using a non-extractable AES-GCM `CryptoKey` that itself lives only in the service worker's IndexedDB (`jtv-keystore`), never in `chrome.storage`. See §5a below and the Non-negotiables changelog note (2026-07-24) in `SKILL.md` for the full reasoning and honest limits |
| `summaryPayload` (`{ rangeLabel, filters, days }`) | `chrome.storage.session` | one-shot handoff from `panel.js` to the summary page it just opened in a new tab — not a session like the connection, just the shortest-lived thing that isn't a URL query string. `summary.js` reads it once and immediately `remove()`s the key, so reopening the summary URL directly later (not via the panel's button) shows an empty state instead of a stale report |
| Workday hours | `chrome.storage.local` | preference, not a credential — not sensitive, safe to persist |
| `startDateFieldId`, `deploymentType` | `chrome.storage.local` | expensive to rediscover, not sensitive on their own (future — Phase 3) |

`chrome.storage.local` is **not encrypted** and survives browser restarts indefinitely — anything with filesystem access to the browser profile can read it, which is exactly why the *default* connection path never touches it. `chrome.storage.session` is different: it's memory-only, the browser itself clears it on full close, and it's never written to the profile on disk. It does survive a service worker being torn down for idle (~30s) — that's the whole point of using it here (see the Non-negotiables changelog note in `SKILL.md`): the original design kept the connection in a plain module-level variable only, and that variable dying with every idle teardown was the actual source of "constantly re-entering credentials", which the user reported as excessive friction. Reconstructing a `JiraClient` from the stored `{ baseUrl, email, token }` on rehydration (see `service-worker.js`'s `loadConnection()`) is required — a `JiraClient` instance itself can't be serialized into `chrome.storage`.

Moving the connection into `chrome.storage.local` unconditionally, or storing the token there in plaintext "for even less friction", is still off the table without checking with the user first. What *is* now implemented (2026-07-24, opt-in, unchecked by default) is `persistedConnection` above — see §5a.

### 5a. Opt-in persistent connection (`secure-store.js`)

When the user checks "Stay connected on this device", `CONNECT` additionally encrypts the token and writes `persistedConnection` to `chrome.storage.local` (table above). `loadConnection()` falls back to it when `chrome.storage.session` is empty (i.e. after a full browser restart): decrypt, rebuild `{ baseUrl, email, token, accountId, displayName, timeZone }`, populate the in-memory cache, and repopulate `chrome.storage.session` so the rest of that worker lifetime reads from session as usual. A decrypt failure (corrupted data, or the IndexedDB key having been cleared out from under it) is treated as "nothing persisted", not an error — the orphaned entry is removed and the user just sees the normal Connect form.

`../lib/secure-store.js` owns the crypto, and only `service-worker.js` imports it — the token still never reaches a page context, same as before. The key: `crypto.subtle.generateKey({name:'AES-GCM', length:256}, false, ['encrypt','decrypt'])`, `extractable: false`, stored as a `CryptoKey` object directly in IndexedDB (structured clone supports this). `extractable: false` blocks `exportKey()` — no script can pull the raw key bytes out to move them to another profile or machine. `DISCONNECT` calls `clearKey()`, which deletes the IndexedDB database outright (crypto-erase), in addition to removing `persistedConnection` from `chrome.storage.local`.

**Honest limit:** this is not resistant to someone with filesystem access to the *entire* Chrome profile directory copied to another machine — IndexedDB and `chrome.storage.local` copied together carry the key alongside the ciphertext, and a determined attacker could in principle automate Chrome itself against that copy to decrypt it. The real protection is against reading `chrome.storage.local`'s on-disk value in isolation (or a compromised page/extension with storage access but not full profile access) — roughly the same protection level as Chrome's own saved-password store. Don't describe this to a user as unbreakable encryption; describe it as "as safe as your browser's saved passwords, and useless if only the ciphertext leaks."

Cache entries carry their own expiry:

```javascript
const CACHE_TTL_MS = 5 * 60 * 1000;

async function cached(key, producer) {
  const { [key]: hit } = await chrome.storage.local.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const value = await producer();
  await chrome.storage.local.set({ [key]: { at: Date.now(), value } });
  return value;
}
```

Key cache entries on everything that changes the result — `timesheet:${from}:${to}:${accountId}` — or a date-range change will serve stale data.

---

## 6. Side panel wiring

```javascript
// service-worker.js — open the panel from the popup
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
```

`chrome.sidePanel.open()` must be called during a user gesture, so it belongs in the popup's click handler, not in a message handler that runs later:

```javascript
// popup.js
document.querySelector('#open-timesheet').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.sidePanel.open({ windowId: tab.windowId });
  await chrome.storage.session.set({ panelTab: 'timesheet' });
  window.close();
});
```

The panel reads `panelTab` on load to select the right tab. Edge supports `chrome.sidePanel` from version 114; if the user is on something older, fall back to `chrome.tabs.create({ url: 'src/panel/panel.html' })`.

---

## 7. CSP and module loading

MV3 forbids inline scripts and `eval`. Every `<script>` is external with `type="module"`:

```html
<script type="module" src="panel.js"></script>
```

No inline `onclick` attributes — attach listeners in JS. No remote scripts; a CDN `<script>` tag is blocked outright and is also a store-review rejection.

---

## 8. Loading and debugging

```
chrome://extensions → Developer mode → Load unpacked → select the project folder
```

- Service worker logs: the "service worker" link on the extension card opens its own DevTools.
- Popup logs: right-click the extension icon → Inspect popup.
- Panel logs: right-click inside the panel → Inspect.
- After editing the worker, hit the reload icon on the card. Editing only popup/panel HTML or JS just needs reopening that surface.
- If the worker shows as "inactive", that's normal — it wakes on the next event.

Edge uses `edge://extensions` with the same flow.
