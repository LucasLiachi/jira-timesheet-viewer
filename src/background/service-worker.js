import { JiraClient, searchAll, mapWithLimit, fetchIssueWorklogs, fetchAllProjects } from '../lib/jira-client.js';
import { buildMyItemsJql } from '../lib/jql.js';
import { dayBoundsMs, isoDateInTimeZone } from '../lib/dates.js';

// The connection (base URL, e-mail, token) lives in chrome.storage.session:
// memory-only storage that the browser itself clears on full browser close,
// and never writes to disk — but, unlike a plain module-level variable, it
// survives the service worker being torn down after ~30s idle (MV3 does this
// aggressively, and re-entering the full form every single time was the
// actual friction, not "once per browser restart" as originally assumed).
// `connection` below is just an in-memory cache of that session entry for
// the current worker's lifetime, so most requests don't need to await
// chrome.storage at all.
let connection = null;

const SESSION_KEY = 'connection';
const ITEM_FIELDS = ['summary', 'status', 'duedate', 'timetracking'];
const WORKLOG_CONCURRENCY = 5;

function serializeError(err) {
  return { message: err.message, status: err.status ?? null, code: err.code ?? null };
}

async function loadConnection() {
  if (connection) return connection;

  const { [SESSION_KEY]: saved } = await chrome.storage.session.get(SESSION_KEY);
  if (!saved) return null;

  connection = { ...saved, client: new JiraClient(saved.baseUrl, saved.email, saved.token) };
  return connection;
}

async function requireConnection() {
  const conn = await loadConnection();
  if (!conn) {
    throw Object.assign(new Error('Not connected'), { status: 0, code: 'NOT_CONNECTED' });
  }
  return conn;
}

const handlers = {
  async CONNECT({ baseUrl, email, token }) {
    const client = new JiraClient(baseUrl, email, token);
    const me = await client.get('/rest/api/3/myself');
    const timeZone = me.timeZone || 'America/Sao_Paulo';

    const saved = {
      baseUrl: client.baseUrl,
      email,
      token,
      accountId: me.accountId,
      displayName: me.displayName,
      timeZone,
    };
    connection = { ...saved, client };
    await chrome.storage.session.set({ [SESSION_KEY]: saved });

    return { displayName: me.displayName, accountId: me.accountId, timeZone };
  },

  async GET_CONNECTION_STATUS() {
    const conn = await loadConnection();
    return conn
      ? {
          connected: true,
          displayName: conn.displayName,
          accountId: conn.accountId,
          baseUrl: conn.baseUrl,
          timeZone: conn.timeZone,
        }
      : { connected: false };
  },

  async DISCONNECT() {
    connection = null;
    await chrome.storage.session.remove(SESSION_KEY);
    return { disconnected: true };
  },

  /**
   * Assigned issues active inside [from, to] (optionally narrowed to
   * `projectKeys`), each annotated with the user's own worklogs per day in
   * that window (`logsByDay`: `{ seconds, comments }` per 'YYYY-MM-DD'). The
   * panel groups by day and shows worklog descriptions from this alone; it
   * never needs a second request per day. Logging time still happens in
   * Jira itself (see `key`, which the panel turns into a link to the
   * issue's own browse page) — this only reads what's already there.
   */
  async SEARCH({ from, to, projectKeys = [] }) {
    const { client, baseUrl, accountId, timeZone } = await requireConnection();

    const jql = buildMyItemsJql({ from, to, projectKeys });
    const rawIssues = await searchAll(client, { jql, fields: ITEM_FIELDS });
    const { startMs, endMs } = dayBoundsMs(from, to, timeZone);

    const issues = await mapWithLimit(rawIssues, WORKLOG_CONCURRENCY, async (issue) => {
      const worklogs = await fetchIssueWorklogs(client, issue.id, startMs, endMs);
      const mine = worklogs.filter((w) => w.author?.accountId === accountId);

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

      return {
        key: issue.key,
        summary: issue.fields.summary,
        statusName: issue.fields.status?.name ?? '',
        statusCategory: issue.fields.status?.statusCategory?.key ?? 'new',
        due: issue.fields.duedate ?? null,
        estimateSeconds: issue.fields.timetracking?.originalEstimateSeconds ?? 0,
        logsByDay,
      };
    });

    return { from, to, baseUrl, issues };
  },

  /** Projects the connected account can see, for the pre-search project filter. */
  async GET_PROJECTS() {
    const { client } = await requireConnection();
    const projects = await fetchAllProjects(client);
    return { projects };
  },
};

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/welcome.html') });
  }
});

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
