export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `Request failed (${status})`);
    this.status = status;
    this.data = data || {};
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = { 'x-requested-with': 'backstretch' };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin', signal });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const get = (p, o) => api(p, o);
export const post = (p, body) => api(p, { method: 'POST', body: body ?? {} });
export const put = (p, body) => api(p, { method: 'PUT', body: body ?? {} });
export const patch = (p, body) => api(p, { method: 'PATCH', body: body ?? {} });
export const del = (p, body) => api(p, { method: 'DELETE', body });
