import { request } from '../lib/messaging.js';
import { mountConnectForm } from '../lib/connect-form.js';

const who = document.getElementById('who');
const connectContainer = document.getElementById('connect-container');
const openPanelBtn = document.getElementById('open-panel');

async function refresh() {
  const conn = await request('GET_CONNECTION_STATUS');
  who.textContent = conn.connected ? `${conn.displayName} · Connected` : 'Not connected';
  connectContainer.hidden = conn.connected;
  openPanelBtn.hidden = !conn.connected;
}

mountConnectForm(connectContainer, { onConnected: refresh });

openPanelBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.sidePanel.open({ windowId: tab.windowId });
  window.close();
});

document.getElementById('open-settings').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById('open-help').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome/welcome.html') });
});

refresh();
