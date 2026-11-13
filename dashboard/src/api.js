// In production set VITE_API_URL to the deployed API (for example https://api.example.com).
const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1';

// The access token lives only in memory. The refresh token is an httpOnly cookie the browser sends itself.
let accessToken = null;
let refreshing = null;
let onSignedOut = () => {};

export function setSignedOutHandler(fn) {
  onSignedOut = fn;
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.error;
    this.details = body?.details;
  }
}

async function raw(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { res, data };
}

/** Uses the refresh cookie to get a new access token. Returns the user, or null if signed out. */
export function refreshSession() {
  refreshing ??= raw('/auth/refresh', { method: 'POST', auth: false })
    .then(({ res, data }) => {
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      accessToken = data.accessToken;
      return data.user;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function api(path, options = {}) {
  let { res, data } = await raw(path, options);
  if (res.status === 401 && options.auth !== false) {
    const user = await refreshSession();
    if (!user) {
      onSignedOut();
      throw new ApiError(401, data);
    }
    ({ res, data } = await raw(path, options));
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const getHealth = async () => {
  const { res, data } = await raw('/health', { auth: false });
  return { ok: res.ok, ...(data ?? {}) };
};

export const requestCode = (phone) => api('/auth/otp/request', { method: 'POST', body: { phone }, auth: false });

export async function verifyCode(phone, code, name) {
  const data = await api('/auth/otp/verify', {
    method: 'POST',
    body: { phone, code, ...(name ? { name } : {}) },
    auth: false,
  });
  accessToken = data.accessToken;
  return data.user;
}

export async function signOut() {
  await raw('/auth/logout', { method: 'POST', auth: false }).catch(() => {});
  accessToken = null;
}

export const listDevices = () => api('/devices').then((d) => d.devices);
export const updateDevice = (id, changes) => api(`/devices/${id}`, { method: 'PATCH', body: changes }).then((d) => d.device);
export const removeDevice = (id) => api(`/devices/${id}`, { method: 'DELETE' });
export const getRoute = (id, from, to) => {
  const q = new URLSearchParams();
  if (from) q.set('from', from.toISOString());
  if (to) q.set('to', to.toISOString());
  return api(`/devices/${id}/locations?${q}`).then((d) => d.points);
};
export const sendCommand = (id, type, payload) =>
  api(`/devices/${id}/commands`, { method: 'POST', body: { type, ...(payload ? { payload } : {}) } }).then((d) => d.command);
export const listCommands = (id) => api(`/devices/${id}/commands`).then((d) => d.commands);

export const updateMe = (changes) => api('/auth/me', { method: 'PATCH', body: changes }).then((d) => d.user);
export const listAlerts = (deviceId) => api(`/alerts${deviceId ? `?deviceId=${deviceId}` : ''}`);
export const markAlertsRead = (ids) => api('/alerts/read', { method: 'POST', body: ids ? { ids } : {} });
export const getPilotStats = () => api('/admin/stats');
