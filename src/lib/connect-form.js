import { request } from './messaging.js';

/**
 * Mounts the shared Connect form into `container`. This is the only place in
 * the UI that ever touches the base URL / e-mail / API token — see
 * SKILL.md "Non-negotiables": it's handed to the service worker once via
 * CONNECT and forgotten by this form immediately. The service worker keeps it
 * in chrome.storage.session (memory-only, cleared when the browser closes,
 * never written to disk) — not in this form, and not in chrome.storage.local.
 *
 * The `autocomplete` hints below are for the user's own password manager, not
 * for us — see README.md "Usando um gerenciador de senhas". Whether a given
 * browser/manager actually offers to save or fill this form is up to them;
 * we just give the standard hints and stay out of the way.
 */
export function mountConnectForm(container, { onConnected } = {}) {
  container.innerHTML = `
    <form class="connect-form">
      <label>Jira base URL
        <input name="baseUrl" type="url" autocomplete="url" placeholder="https://your-domain.atlassian.net" required />
      </label>
      <label>Email
        <input name="email" type="email" autocomplete="username" required />
      </label>
      <label>API token
        <input name="token" type="password" autocomplete="current-password" required />
      </label>
      <p class="connect-disclosure">
        Create a token at id.atlassian.com under Security &rarr; API tokens.
        Kept in memory for this browser session only — cleared when you close the browser, never written to disk.
      </p>
      <button type="submit">Connect</button>
      <p class="connect-status" role="status"></p>
    </form>
  `;

  const form = container.querySelector('form');
  const status = container.querySelector('.connect-status');
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = '';
    submitBtn.disabled = true;
    const data = new FormData(form);
    try {
      const result = await request('CONNECT', {
        baseUrl: String(data.get('baseUrl') ?? '').trim(),
        email: String(data.get('email') ?? '').trim(),
        token: String(data.get('token') ?? ''),
      });
      form.reset();
      onConnected?.(result);
    } catch {
      status.textContent = 'Could not connect. Check the URL, email and token.';
    } finally {
      submitBtn.disabled = false;
    }
  });
}
