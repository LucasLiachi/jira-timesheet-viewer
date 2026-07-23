export class JiraClient {
  constructor(baseUrl, email, token) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
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

/** Paginates `POST /rest/api/3/search/jql` to completion via nextPageToken. */
export async function searchAll(client, { jql, fields, pageSize = 100 }) {
  const issues = [];
  let nextPageToken;

  do {
    const body = { jql, fields, maxResults: pageSize };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const data = await client.post('/rest/api/3/search/jql', body);
    issues.push(...(data.issues ?? []));
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  return issues;
}

/** Every project the connected account can see, for the project filter. */
export async function fetchAllProjects(client) {
  const projects = [];
  let startAt = 0;

  while (true) {
    const params = new URLSearchParams({
      startAt: String(startAt),
      maxResults: '50',
      orderBy: 'name',
    });
    const data = await client.get(`/rest/api/3/project/search?${params}`);
    const batch = data.values ?? [];
    projects.push(...batch.map((p) => ({ key: p.key, name: p.name })));

    startAt += batch.length;
    if (batch.length === 0 || data.isLast || startAt >= (data.total ?? 0)) break;
  }

  return projects;
}

/**
 * Worklogs for one issue inside [fromMs, toMs), filtered server-side.
 * Deliberately v2, not v3: v3 returns `comment` as an ADF tree, v2 as a plain
 * string — do not "upgrade" this without adding an ADF flattener first.
 */
export async function fetchIssueWorklogs(client, issueId, fromMs, toMs) {
  const out = [];
  let startAt = 0;

  while (true) {
    const params = new URLSearchParams({
      startAt: String(startAt),
      maxResults: '100',
      startedAfter: String(fromMs),
      startedBefore: String(toMs),
    });

    const data = await client.get(`/rest/api/2/issue/${issueId}/worklog?${params}`);
    const batch = data.worklogs ?? [];
    out.push(...batch);

    startAt += batch.length;
    if (batch.length === 0 || startAt >= (data.total ?? 0)) break;
  }

  return out;
}
