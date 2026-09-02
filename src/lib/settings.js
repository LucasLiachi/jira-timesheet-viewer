// Preferences only. Corporate connection data (base URL, e-mail, API token)
// is never stored here — it lives in-memory in the service worker only.
// See src/background/service-worker.js.
const KEYS = ['workdayHours'];

const DEFAULTS = {
  workdayHours: 8,
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(KEYS);
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(partial) {
  await chrome.storage.local.set(partial);
}
