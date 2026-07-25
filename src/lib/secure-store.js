/**
 * Encrypts the API token for optional persistence across browser restarts
 * ("Stay connected on this device" in the connect form) — used only by
 * service-worker.js, never by a page context, keeping the non-negotiable
 * that the token itself never reaches popup/panel/options code.
 *
 * The AES-GCM key is generated once with `extractable: false` and stored as
 * a CryptoKey object directly in IndexedDB (structured clone supports this
 * natively). `extractable: false` blocks any `exportKey()` call from ever
 * pulling the raw key bytes out via script — so the ciphertext this module
 * writes to chrome.storage.local is opaque without this exact IndexedDB
 * entry, in this exact browser profile. That is real protection against
 * casual reads of chrome.storage.local's on-disk file, or a compromised
 * page trying to exfiltrate the key — but it is not protection against
 * someone with full filesystem access to the whole Chrome profile
 * directory: copying IndexedDB and chrome.storage.local together off disk
 * carries the key along with the ciphertext. See CLAUDE.md for the full
 * writeup of what this does and doesn't defend against.
 */

const DB_NAME = 'jtv-keystore';
const STORE_NAME = 'keys';
const KEY_ID = 'token-key';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const result = fn(store);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function getOrCreateKey() {
  const existing = await withStore('readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(KEY_ID);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  });
  if (existing) return existing;

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await withStore('readwrite', (store) => store.put(key, KEY_ID));
  return key;
}

function toBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function fromBase64(base64) {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export async function encryptToken(token) {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(token)
  );
  return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

export async function decryptToken({ iv, ciphertext }) {
  const key = await getOrCreateKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    key,
    fromBase64(ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

/** Crypto-erase: deletes the whole keystore, making any stored ciphertext permanently unrecoverable. */
export function clearKey() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
