#!/usr/bin/env python3
"""Scaffold the Jira Timesheet Viewer extension skeleton.

Usage:
    python scaffold.py <target-dir> [--force]

Creates a loadable MV3 extension: the popup already has an inline Connect form
(base URL, e-mail, API token) that runs a connection test against
GET /rest/api/3/myself. Nothing about the connection is ever written to
chrome.storage — it lives only in a module-level variable inside the service
worker, for that worker's lifetime. Everything else is a stub with a TODO
pointing at the phase that fills it in.

Refuses to overwrite an existing directory unless --force is passed.
"""

import argparse
import json
import sys
from pathlib import Path

MANIFEST = {
    "manifest_version": 3,
    "name": "Jira Timesheet Viewer",
    "version": "0.1.0",
    "description": "Search and view your assigned Jira issues in a date range.",
    "permissions": ["storage", "sidePanel"],  # add "alarms" only once Phase 6 actually calls chrome.alarms
    "host_permissions": ["https://*.atlassian.net/*"],
    "background": {
        "service_worker": "src/background/service-worker.js",
        "type": "module",
    },
    "action": {"default_popup": "src/popup/popup.html"},
    "side_panel": {"default_path": "src/panel/panel.html"},
    "options_page": "src/options/options.html",
}

SERVICE_WORKER = '''\
import { JiraClient } from '../lib/jira-client.js';

// In-memory only, by design: the connection (base URL, e-mail, token) is
// never written to chrome.storage.local or chrome.storage.session. It is set
// once per CONNECT message and disappears whenever this worker is torn down
// (MV3 idle teardown or browser restart) — the popup then shows the Connect
// form again. Do not "fix" that by persisting this object.
let connection = null;

function serializeError(err) {
  return { message: err.message, status: err.status ?? null, code: err.code ?? null };
}

function requireConnection() {
  if (!connection) {
    throw Object.assign(new Error('Not connected'), { status: 0, code: 'NOT_CONNECTED' });
  }
  return connection;
}

const handlers = {
  async CONNECT({ baseUrl, email, token }) {
    const client = new JiraClient(baseUrl, email, token);
    const me = await client.get('/rest/api/3/myself');
    connection = {
      client,
      accountId: me.accountId,
      displayName: me.displayName,
      timeZone: me.timeZone,
    };
    return { displayName: me.displayName, accountId: me.accountId, timeZone: me.timeZone };
  },

  async GET_CONNECTION_STATUS() {
    return connection
      ? { connected: true, displayName: connection.displayName, accountId: connection.accountId }
      : { connected: false };
  },

  async DISCONNECT() {
    connection = null;
    return { disconnected: true };
  },

  // Phase 2
  async GET_MY_ITEMS() {
    requireConnection();
    throw new Error('GET_MY_ITEMS not implemented yet');
  },

  // Phase 4
  async GET_TIMESHEET() {
    requireConnection();
    throw new Error('GET_TIMESHEET not implemented yet');
  },
};

// Registered synchronously at the top level so it survives worker restarts.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) {
    sendResponse({ ok: false, error: { message: `Unknown message: ${msg?.type}` } });
    return false;
  }
  handler(msg.payload ?? {})
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: serializeError(err) }));
  return true; // async response
});
'''

JIRA_CLIENT = '''\
export class JiraClient {
  constructor(baseUrl, email, token) {
    this.baseUrl = String(baseUrl).replace(/\\/+$/, '');
    // Never log, expose or forward this header.
    this.auth = `Basic ${btoa(`${email}:${token}`)}`;
  }

  async request(method, path, body) {
    const doFetch = () =>
      fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: this.auth,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

    const res = await withRetry(doFetch);

    if (!res.ok) {
      // Deliberately excludes the request headers from the error.
      throw Object.assign(new Error(await safeText(res)), { status: res.status });
    }
    return res.status === 204 ? null : res.json();
  }

  get(path) {
    return this.request('GET', path);
  }

  post(path, body) {
    return this.request('POST', path, body);
  }
}

async function withRetry(doFetch, maxAttempts = 4) {
  for (let attempt = 1; ; attempt++) {
    const res = await doFetch();
    if (res.status !== 429 || attempt === maxAttempts) return res;

    const retryAfter = Number(res.headers.get('Retry-After'));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(2 ** attempt * 500, 8000);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function safeText(res) {
  try {
    const t = await res.text();
    return t.slice(0, 300) || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** Runs fn over items with at most `limit` in flight. */
export async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
'''

SETTINGS = '''\
// Preferences only. Corporate connection data (base URL, e-mail, API token)
// is never stored here — it lives in-memory in the service worker only.
// See src/background/service-worker.js.
const KEYS = ['workdayHours', 'timeZone', 'cacheMinutes', 'startDateFieldId'];

const DEFAULTS = {
  workdayHours: 8,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  cacheMinutes: 5,
  startDateFieldId: null,
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(KEYS);
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(partial) {
  await chrome.storage.local.set(partial);
}
'''

MESSAGING = '''\
export async function request(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, payload });
  if (!res?.ok) {
    throw Object.assign(new Error(res?.error?.message ?? 'Unknown error'), {
      status: res?.error?.status ?? null,
    });
  }
  return res.data;
}
'''

OPTIONS_HTML = '''\
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Jira Timesheet Viewer — Settings</title>
    <link rel="stylesheet" href="options.css" />
  </head>
  <body>
    <main>
      <h1>Settings</h1>

      <!-- Read-only: this page observes the connection, it doesn't create one.
           Base URL / e-mail / API token are entered on the popup's Connect form
           and are never persisted here or anywhere else. -->
      <p id="status" role="status">Not connected</p>

      <section>
        <h2>Preferences</h2>
        <label>Working hours per day
          <input id="workdayHours" type="number" min="1" max="24" step="0.5" value="8" />
        </label>
      </section>

      <section>
        <h2>Data</h2>
        <button id="disconnect" type="button">Disconnect</button>
      </section>

      <div class="actions">
        <button id="save" type="button">Save</button>
      </div>
    </main>
    <script type="module" src="options.js"></script>
  </body>
</html>
'''

OPTIONS_JS = '''\
import { getSettings, saveSettings } from '../lib/settings.js';
import { request } from '../lib/messaging.js';

const $ = (id) => document.getElementById(id);
const status = $('status');

function setStatus(text, kind = '') {
  status.textContent = text;
  status.className = kind;
}

async function load() {
  const s = await getSettings();
  $('workdayHours').value = s.workdayHours;

  const conn = await request('GET_CONNECTION_STATUS');
  setStatus(conn.connected ? `Connected as ${conn.displayName}` : 'Not connected', conn.connected ? 'ok' : '');
}

$('save').addEventListener('click', async () => {
  await saveSettings({ workdayHours: Number($('workdayHours').value) });
  setStatus('Preferences saved.', 'ok');
});

$('disconnect').addEventListener('click', async () => {
  await request('DISCONNECT');
  setStatus('Not connected');
});

load();
'''

OPTIONS_CSS = '''\
:root {
  --bg: #fff; --bg-subtle: #f4f5f7; --border: #dfe1e6;
  --text: #172b4d; --text-subtle: #6b778c; --accent: #0052cc;
  --success: #36b37e; --danger: #de350b; --radius: 3px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #1d2125; --bg-subtle: #22272b; --border: #38414a;
          --text: #b6c2cf; --text-subtle: #8c9bab; --accent: #579dff; }
}
body { font-family: var(--font); background: var(--bg); color: var(--text); margin: 0; }
main { max-width: 520px; margin: 0 auto; padding: 24px; }
h1 { font-size: 20px; }
h2 { font-size: 14px; text-transform: uppercase; color: var(--text-subtle); margin-top: 28px; }
label { display: block; margin-bottom: 12px; font-size: 13px; }
input[type=number] {
  display: block; width: 100%; box-sizing: border-box; margin-top: 4px; padding: 6px 8px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-subtle); color: var(--text);
}
small { color: var(--text-subtle); font-size: 12px; }
.actions { margin-top: 24px; display: flex; gap: 8px; }
button { padding: 6px 14px; border: none; border-radius: var(--radius);
         background: var(--accent); color: #fff; cursor: pointer; font-size: 13px; }
button:hover { filter: brightness(1.1); }
#status { font-size: 13px; min-height: 18px; }
#status.ok { color: var(--success); }
#status.error { color: var(--danger); }
'''

POPUP_HTML = '''\
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Jira Timesheet Viewer</title>
    <style>
      body { width: 360px; margin: 0; font-family: -apple-system, "Segoe UI", sans-serif; }
      main { padding: 16px; }
      label { display: block; margin-bottom: 10px; font-size: 13px; }
      input { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; padding: 6px 8px; }
      small { display: block; color: #6b778c; font-size: 12px; margin-bottom: 10px; }
      #status { font-size: 13px; min-height: 18px; color: #de350b; }
    </style>
  </head>
  <body>
    <main>
      <h1>Jira Timesheet Viewer</h1>
      <p id="who">Not connected</p>

      <!-- Nothing typed here is ever persisted — see SKILL.md "Non-negotiables". -->
      <form id="connect-form">
        <label>Jira base URL
          <input id="baseUrl" type="url" placeholder="https://your-domain.atlassian.net" required />
        </label>
        <label>Email
          <input id="email" type="email" required />
        </label>
        <label>API token
          <input id="token" type="password" required />
        </label>
        <small>Create a token at id.atlassian.com under Security &rarr; API tokens. Nothing is saved — you'll enter it again next time.</small>
        <button type="submit">Connect</button>
      </form>
      <p id="status" role="status"></p>

      <!-- TODO Phase 2: period selector + My Items / Timesheet buttons, shown once connected -->
    </main>
    <script type="module" src="popup.js"></script>
  </body>
</html>
'''

POPUP_JS = '''\
import { request } from '../lib/messaging.js';

const who = document.getElementById('who');
const form = document.getElementById('connect-form');
const status = document.getElementById('status');

async function refresh() {
  const conn = await request('GET_CONNECTION_STATUS');
  who.textContent = conn.connected ? `${conn.displayName} · Connected` : 'Not connected';
  form.hidden = conn.connected;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.textContent = '';
  try {
    await request('CONNECT', {
      baseUrl: document.getElementById('baseUrl').value.trim(),
      email: document.getElementById('email').value.trim(),
      token: document.getElementById('token').value,
    });
    await refresh();
  } catch {
    status.textContent = 'Could not connect. Check the URL, email and token.';
  }
});

refresh();
'''

PANEL_HTML = '''\
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Jira Timesheet Viewer</title>
  </head>
  <body>
    <!-- TODO Phase 2: My Items tab. Phase 4: Timesheet tab. -->
    <p>Side panel placeholder.</p>
    <script type="module" src="panel.js"></script>
  </body>
</html>
'''

PANEL_JS = "// TODO Phase 2 / Phase 4 — see references/ui-spec.md\n"

FILES = {
    "manifest.json": json.dumps(MANIFEST, indent=2) + "\n",
    "src/background/service-worker.js": SERVICE_WORKER,
    "src/lib/jira-client.js": JIRA_CLIENT,
    "src/lib/settings.js": SETTINGS,
    "src/lib/messaging.js": MESSAGING,
    "src/lib/jql.js": "// TODO Phase 2 — see references/jira-api.md §5\n",
    "src/lib/fields.js": "// TODO Phase 3 — see references/jira-api.md §3\n",
    "src/lib/dates.js": "// TODO Phase 2 — timezone-safe day bucketing\n",
    "src/options/options.html": OPTIONS_HTML,
    "src/options/options.js": OPTIONS_JS,
    "src/options/options.css": OPTIONS_CSS,
    "src/popup/popup.html": POPUP_HTML,
    "src/popup/popup.js": POPUP_JS,
    "src/panel/panel.html": PANEL_HTML,
    "src/panel/panel.js": PANEL_JS,
}
# Deliberately no ".gitignore" entry: this scaffolds an extension's source
# tree, not repo metadata. A repo the target is dropped into may already have
# a real .gitignore, and --force must never let this script clobber it (that
# happened once — see git history if you're wondering why this comment exists).


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", help="directory to create the extension in")
    parser.add_argument("--force", action="store_true", help="write into an existing directory")
    args = parser.parse_args()

    root = Path(args.target).expanduser().resolve()
    if root.exists() and any(root.iterdir()) and not args.force:
        print(f"error: {root} exists and is not empty. Use --force to write into it.", file=sys.stderr)
        return 1

    for rel, content in FILES.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    (root / "icons").mkdir(exist_ok=True)

    print(f"Scaffolded {len(FILES)} files in {root}")
    print("Add PNG icons (16/48/128) to icons/ and re-add the `icons` key to manifest.json.")
    print("Load it: chrome://extensions -> Developer mode -> Load unpacked -> select this folder.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
