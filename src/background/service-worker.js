import { JiraClient, searchAll, mapWithLimit, fetchIssueWorklogs, fetchAllProjects } from '../lib/jira-client.js';
import { buildMyItemsJql, buildWorklogJql } from '../lib/jql.js';
import { isoDateInTimeZone } from '../lib/dates.js';
import { encryptToken, decryptToken, clearKey } from '../lib/secure-store.js';

// The connection (base URL, e-mail, token) lives in chrome.storage.session:
// memory-only storage that the browser itself clears on full browser close,
// and never writes to disk — but, unlike a plain module-level variable, it
// survives the service worker being torn down after ~30s idle (MV3 does this
// aggressively, and re-entering the full form every single time was the
// actual friction, not "once per browser restart" as originally assumed).
// `connection` below is just an in-memory cache of that session entry for
// the current worker's lifetime, so most requests don't need to await
// chrome.storage at all.
//
// Optionally, if the user checked "Stay connected on this device" on the
// connect form, a second copy survives full browser restarts too: the
// token, encrypted with a non-extractable WebCrypto key held in IndexedDB
// (see ../lib/secure-store.js), in PERSIST_KEY below. That's an explicit
// opt-in per connection, not the default — see CLAUDE.md for why.
let connection = null;

const SESSION_KEY = 'connection';
const PERSIST_KEY = 'persistedConnection';
const ITEM_FIELDS = ['summary', 'status', 'duedate', 'timetracking', 'issuetype'];
const WORKLOG_CONCURRENCY = 5;

function serializeError(err) {
  return { message: err.message, status: err.status ?? null, code: err.code ?? null };
}

async function loadConnection() {
  if (connection) return connection;

  const { [SESSION_KEY]: saved } = await chrome.storage.session.get(SESSION_KEY);
  if (saved) {
    connection = { ...saved, client: new JiraClient(saved.baseUrl, saved.email, saved.token) };
    return connection;
  }

  const { [PERSIST_KEY]: persisted } = await chrome.storage.local.get(PERSIST_KEY);
  if (!persisted) return null;

  try {
    const token = await decryptToken(persisted.tokenCiphertext);
    const restored = {
      baseUrl: persisted.baseUrl,
      email: persisted.email,
      token,
      accountId: persisted.accountId,
      displayName: persisted.displayName,
      timeZone: persisted.timeZone,
    };
    connection = { ...restored, client: new JiraClient(restored.baseUrl, restored.email, restored.token) };
    await chrome.storage.session.set({ [SESSION_KEY]: restored });
    return connection;
  } catch {
    // Corrupted ciphertext, or the IndexedDB key was cleared out from under
    // it — treat as "nothing persisted" rather than throwing, and drop the
    // now-useless entry so this doesn't retry every request.
    await chrome.storage.local.remove(PERSIST_KEY);
    return null;
  }
}

async function requireConnection() {
  const conn = await loadConnection();
  if (!conn) {
    throw Object.assign(new Error('Not connected'), { status: 0, code: 'NOT_CONNECTED' });
  }
  return conn;
}

const handlers = {
  async CONNECT({ baseUrl, email, token, remember = false }) {
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

    if (remember) {
      const tokenCiphertext = await encryptToken(token);
      await chrome.storage.local.set({
        [PERSIST_KEY]: {
          baseUrl: saved.baseUrl,
          email: saved.email,
          accountId: saved.accountId,
          displayName: saved.displayName,
          timeZone: saved.timeZone,
          tokenCiphertext,
        },
      });
    } else {
      await chrome.storage.local.remove(PERSIST_KEY);
    }

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
    await chrome.storage.local.remove(PERSIST_KEY);
    await clearKey();
    return { disconnected: true };
  },

  /**
   * Timesheet context — issues that have worklogs logged by the user in [from, to].
   * Uses buildWorklogJql (worklogAuthor = currentUser() AND worklogDate) to query
   * candidate issues, then fetches and aggregates worklog details per day.
   */
  async SEARCH_WORKLOGS({ from, to }) {
    const { client, baseUrl, accountId, timeZone, email, displayName } = await requireConnection();

    const jql = buildWorklogJql({ from, to });
    const rawIssues = await searchAll(client, { jql, fields: ITEM_FIELDS });

    const allIssues = await mapWithLimit(rawIssues, WORKLOG_CONCURRENCY, async (issue) => {
      const worklogs = await fetchIssueWorklogs(client, issue.id);
      const mine = worklogs.filter((w) => {
        if (!w.author) return false;
        return w.author.accountId === accountId ||
               (email && w.author.emailAddress === email) ||
               w.author.key === accountId ||
               w.author.name === accountId ||
               (displayName && w.author.displayName === displayName);
      });

      const logsByDay = {};
      for (const wl of mine) {
        if (!wl.started) continue;
        const startedMs = Date.parse(wl.started);
        const day = isoDateInTimeZone(startedMs, timeZone);
        
        // Garantir no cliente que só pegamos os worklogs que realmente caem no período
        if (day < from || day > to) continue;

        const entry = logsByDay[day] ?? { seconds: 0, entries: [] };
        const seconds = wl.timeSpentSeconds ?? 0;
        entry.seconds += seconds;
        const comment = typeof wl.comment === 'string' ? wl.comment.trim() : '';
        entry.entries.push({ seconds, comment, started: startedMs });
        logsByDay[day] = entry;
      }

      return {
        key: issue.key,
        summary: issue.fields.summary,
        statusName: issue.fields.status?.name ?? '',
        statusCategory: issue.fields.status?.statusCategory?.key ?? 'new',
        issueType: issue.fields.issuetype?.name ?? '',
        due: issue.fields.duedate ?? null,
        estimateSeconds: issue.fields.timetracking?.originalEstimateSeconds ?? 0,
        logsByDay,
      };
    });

    // Keep only issues that actually have worklogs from this user in the period.
    const issues = allIssues.filter((issue) => Object.keys(issue.logsByDay).length > 0);

    return { from, to, baseUrl, issues };
  },

  /**
   * My Items context — issues assigned to the current user, active inside
   * [from, to] (optionally narrowed to `projectKeys`). Each issue is
   * annotated with the user's worklogs per day so the panel can identify
   * which items have zero logged time in the period.
   */
  async SEARCH_MY_ITEMS({ from, to, projectKeys = [] }) {
    const { client, baseUrl, accountId, timeZone, email, displayName } = await requireConnection();

    const jql = buildMyItemsJql({ from, to, projectKeys });
    const rawIssues = await searchAll(client, { jql, fields: ITEM_FIELDS });

    const issues = await mapWithLimit(rawIssues, WORKLOG_CONCURRENCY, async (issue) => {
      const worklogs = await fetchIssueWorklogs(client, issue.id);
      const mine = worklogs.filter((w) => {
        if (!w.author) return false;
        return w.author.accountId === accountId ||
               (email && w.author.emailAddress === email) ||
               w.author.key === accountId ||
               w.author.name === accountId ||
               (displayName && w.author.displayName === displayName);
      });

      const logsByDay = {};
      for (const wl of mine) {
        if (!wl.started) continue;
        const startedMs = Date.parse(wl.started);
        const day = isoDateInTimeZone(startedMs, timeZone);
        
        // Garantir no cliente que só pegamos os worklogs que realmente caem no período
        if (day < from || day > to) continue;

        const entry = logsByDay[day] ?? { seconds: 0, entries: [] };
        const seconds = wl.timeSpentSeconds ?? 0;
        entry.seconds += seconds;
        const comment = typeof wl.comment === 'string' ? wl.comment.trim() : '';
        entry.entries.push({ seconds, comment, started: startedMs });
        logsByDay[day] = entry;
      }

      return {
        key: issue.key,
        summary: issue.fields.summary,
        statusName: issue.fields.status?.name ?? '',
        statusCategory: issue.fields.status?.statusCategory?.key ?? 'new',
        issueType: issue.fields.issuetype?.name ?? '',
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
