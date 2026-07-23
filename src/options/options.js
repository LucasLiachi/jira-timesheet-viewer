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
