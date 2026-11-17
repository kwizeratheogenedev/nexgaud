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

// file: a File or Blob sent as the raw body (proof photos). as: 'blob' to read a file back.
async function raw(path, { method = 'GET', body, auth = true, file, as } = {}) {
  const headers = {};
  if (file) headers['Content-Type'] = file.type || 'application/octet-stream';
  else if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    credentials: 'include',
    body: file ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  let data = null;
  if (res.status !== 204) data = as === 'blob' && res.ok ? await res.blob() : await res.json().catch(() => null);
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

// Stolen-device registry (owners)
export const listRegistry = () => api('/registry/items').then((d) => d.items);
export const registerItem = (body) => api('/registry/items', { method: 'POST', body }).then((d) => d.item);
export const updateItem = (id, body) => api(`/registry/items/${id}`, { method: 'PATCH', body }).then((d) => d.item);
export const deleteItem = (id) => api(`/registry/items/${id}`, { method: 'DELETE' });
export const uploadProof = (id, kind, file) =>
  api(`/registry/items/${id}/proofs?kind=${kind}`, { method: 'POST', file }).then((d) => d.item);
export const deleteProof = (id, proofId) => api(`/registry/items/${id}/proofs/${proofId}`, { method: 'DELETE' }).then((d) => d.item);
export const getProof = (id, proofId) => api(`/registry/items/${id}/proofs/${proofId}`, { as: 'blob' });
export const reportItem = (id, body) => api(`/registry/items/${id}/reports`, { method: 'POST', body }).then((d) => d.item);
export const closeReport = (id, reason) => api(`/registry/items/${id}/reports/close`, { method: 'POST', body: { reason } }).then((d) => d.item);
export const startTransfer = (id) => api(`/registry/items/${id}/transfer`, { method: 'POST' });
export const cancelTransfer = (id) => api(`/registry/items/${id}/transfer`, { method: 'DELETE' });
export const claimItem = (identifier, code) => api('/registry/claim', { method: 'POST', body: { identifier, code } }).then((d) => d.item);
export const listDisputes = () => api('/registry/disputes').then((d) => d.disputes);
export const openDispute = (body) => api('/registry/disputes', { method: 'POST', body }).then((d) => d.dispute);
export const addEvidence = (id, file) => api(`/registry/disputes/${id}/evidence`, { method: 'POST', file }).then((d) => d.dispute);

// Public check (no sign-in)
export const checkPhone = (q) => api(`/check?q=${encodeURIComponent(q)}`, { auth: false });
export const sendTip = (body) => api('/check/tip', { method: 'POST', body, auth: false });

// Partner portal
export const getPartner = () => api('/partner/me');
export const partnerCheck = (items) => api('/partner/check', { method: 'POST', body: { items } });
export const partnerChecks = () => api('/partner/checks');
export const createApiKey = (name) => api('/partner/keys', { method: 'POST', body: { name } });
export const revokeApiKey = (id) => api(`/partner/keys/${id}`, { method: 'DELETE' });

// NexGuard team: registry admin
export const adminRegistryStats = () => api('/admin/registry/stats');
export const adminReports = (status = 'pending') => api(`/admin/registry/reports?status=${status}`).then((d) => d.reports);
export const reviewReport = (id, body) => api(`/admin/registry/reports/${id}/review`, { method: 'POST', body });
export const adminCloseReport = (id, body) => api(`/admin/registry/reports/${id}/close`, { method: 'POST', body });
export const adminDisputes = (status = 'open') => api(`/admin/registry/disputes?status=${status}`).then((d) => d.disputes);
export const resolveDispute = (id, body) => api(`/admin/registry/disputes/${id}/resolve`, { method: 'POST', body });
export const adminUpload = (id) => api(`/admin/registry/uploads/${id}`, { as: 'blob' });
export const adminSearchItems = (q) => api(`/admin/registry/items?q=${encodeURIComponent(q)}`).then((d) => d.items);
export const adminPartners = () => api('/admin/partners').then((d) => d.partners);
export const createPartner = (body) => api('/admin/partners', { method: 'POST', body }).then((d) => d.partner);
export const updatePartner = (id, body) => api(`/admin/partners/${id}`, { method: 'PATCH', body }).then((d) => d.partner);
export const addPartnerMember = (id, body) => api(`/admin/partners/${id}/members`, { method: 'POST', body }).then((d) => d.partner);
export const removePartnerMember = (id, userId) => api(`/admin/partners/${id}/members/${userId}`, { method: 'DELETE' }).then((d) => d.partner);
export const adminAudit = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return api(`/admin/audit?${q}`).then((d) => d.entries);
};

/** Opens a downloaded file (a Blob) in a new tab. */
export function openBlob(blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Laptops (pairing codes for the agent)
export const makePairingCode = (body) => api('/devices/pairing-codes', { method: 'POST', body });

// QR tags (owners)
export const listTags = () => api('/tags').then((d) => d.tags);
export const createTags = (body) => api('/tags', { method: 'POST', body }).then((d) => d.tags);
export const claimTag = (body) => api('/tags/claim', { method: 'POST', body }).then((d) => d.tag);
export const updateTag = (id, body) => api(`/tags/${id}`, { method: 'PATCH', body }).then((d) => d.tag);
export const disableTag = (id) => api(`/tags/${id}`, { method: 'DELETE' });
export const listThreads = () => api('/tags/threads/all').then((d) => d.threads);
export const readThread = (id) => api(`/tags/threads/${id}/read`, { method: 'POST' }).then((d) => d.thread);
export const replyThread = (id, text) => api(`/tags/threads/${id}/reply`, { method: 'POST', body: { text } });
export const closeThread = (id) => api(`/tags/threads/${id}/close`, { method: 'POST' }).then((d) => d.thread);

// QR tags (finders, no sign-in)
export const scanTag = (code, repeat) => api(`/tags/public/${encodeURIComponent(code)}${repeat ? '?repeat=1' : ''}`, { auth: false }).then((d) => d.tag);
export const startThread = (code, body) => api(`/tags/public/${encodeURIComponent(code)}/threads`, { method: 'POST', body, auth: false });
export const getFinderThread = (token) => api(`/tags/public/threads/${token}`, { auth: false }).then((d) => d.thread);
export const finderMessage = (token, body) => api(`/tags/public/threads/${token}/messages`, { method: 'POST', body, auth: false }).then((d) => d.thread);

// Organisations
export const listOrgs = () => api('/orgs').then((d) => d.orgs);
export const createOrg = (body) => api('/orgs', { method: 'POST', body }).then((d) => d.org);
export const updateOrg = (id, body) => api(`/orgs/${id}`, { method: 'PATCH', body }).then((d) => d.org);
export const addOrgMember = (id, phone) => api(`/orgs/${id}/members`, { method: 'POST', body: { phone } }).then((d) => d.org);
export const removeOrgMember = (id, userId) => api(`/orgs/${id}/members/${userId}`, { method: 'DELETE' }).then((d) => d.org);

// NexGuard team: tags, laptops, organisations
export const phase4Stats = () => api('/admin/phase4/stats');
export const listTagBatches = () => api('/admin/tag-batches').then((d) => d.batches);
export const createTagBatch = (body) => api('/admin/tag-batches', { method: 'POST', body }).then((d) => d.batch);
export const tagBatchSheet = (id) => api(`/admin/tag-batches/${id}/tags`);
export const adminOrgs = () => api('/admin/orgs').then((d) => d.orgs);
export const setOrgStatus = (id, status) => api(`/admin/orgs/${id}`, { method: 'PATCH', body: { status } });

/** The API address a laptop agent should use (shown in the pairing steps). */
export const apiBaseForAgents = () => new URL(BASE, window.location.origin).href;

// Plans and billing
export const billingMe = () => api('/billing/me');
export const checkout = (body) => api('/billing/checkout', { method: 'POST', body }).then((d) => d.invoice);
export const listInvoices = () => api('/billing/invoices').then((d) => d.invoices);
export const getInvoice = (id) => api(`/billing/invoices/${id}`);
export const payInvoice = (id, provider, phone) => api(`/billing/invoices/${id}/pay`, { method: 'POST', body: { provider, phone } }).then((d) => d.payment);
export const getPayment = (id) => api(`/billing/payments/${id}`);
export const voidInvoice = (id) => api(`/billing/invoices/${id}/void`, { method: 'POST' }).then((d) => d.invoice);

// Family sharing
export const getFamily = () => api('/family').then((d) => d.family);
export const createFamily = (name) => api('/family', { method: 'POST', body: name ? { name } : {} }).then((d) => d.family);
export const addFamilyMember = (phone) => api('/family/members', { method: 'POST', body: { phone } }).then((d) => d.family);
export const removeFamilyMember = (userId) => api(`/family/members/${userId}`, { method: 'DELETE' }).then((d) => d.family);
export const deleteFamily = () => api('/family', { method: 'DELETE' });

// NexGuard team: billing
export const adminBillingStats = () => api('/admin/billing/stats');

// Live tracking: the device sends its position every few seconds for a while.
export const startLive = (id, seconds) => api(`/devices/${id}/live`, { method: 'POST', body: seconds ? { seconds } : {} });
export const stopLive = (id) => api(`/devices/${id}/live`, { method: 'POST', body: { stop: true } });

/**
 * Opens the device's live feed (server-sent events) and calls onEvent(name, data) for each event.
 * Uses fetch, so the access token goes in the Authorization header rather than the URL.
 * Resolves when the feed ends (network drop, sign-out, or the signal is aborted); the caller reconnects.
 */
export async function openDeviceStream(id, onEvent, signal) {
  const connect = () =>
    fetch(`${BASE}/devices/${id}/stream`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: 'include',
      signal,
    });
  let res = await connect();
  if (res.status === 401 && (await refreshSession())) res = await connect();
  if (!res.ok || !res.body) throw new ApiError(res.status, null);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const name = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (name && data) onEvent(name, JSON.parse(data));
    }
  }
}
