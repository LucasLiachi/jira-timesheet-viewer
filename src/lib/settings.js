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
