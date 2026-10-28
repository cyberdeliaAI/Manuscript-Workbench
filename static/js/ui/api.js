// Calls to the local server (session token header).
const MW_TOKEN = document.querySelector('meta[name="mw-token"]')?.content || '';
export function apiHeaders() {
  return { 'Content-Type': 'application/json', 'X-MW-Token': MW_TOKEN };
}
export function api(path, data, options = {}) {
  return fetch(path, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(data || {}),
    signal: options.signal,
  });
}
export function apiGet(path) {
  return fetch(path, { method: 'GET', headers: { 'X-MW-Token': MW_TOKEN } });
}
