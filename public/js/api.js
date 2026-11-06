async function request(path, options = {}) {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store', ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(body.message || body.error || `Error ${res.status}`);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body;
}

export const getRates = () => request('/api/rates');
export const getHistory = (days = 30) => request(`/api/history?days=${days}`);
export const requestRefresh = () => request('/api/refresh', { method: 'POST' });
