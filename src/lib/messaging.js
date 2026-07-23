export async function request(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, payload });
  if (!res?.ok) {
    throw Object.assign(new Error(res?.error?.message ?? 'Unknown error'), {
      status: res?.error?.status ?? null,
      code: res?.error?.code ?? null,
    });
  }
  return res.data;
}
