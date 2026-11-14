import { config } from '../config.js';

/**
 * Mobile money "collections": NexGuard asks the provider to charge a phone number, the person approves
 * on their phone with their PIN, and NexGuard asks the provider for the result.
 *
 * Each provider has:
 *   request({ reference, amount, currency, phone, description }) → starts the payment (throws on refusal)
 *   status({ reference, providerTxnId }) → { status: 'pending'|'successful'|'failed', providerTxnId?, amount?, reason? }
 *
 * Phone numbers come in E.164 (+250788123456).
 */

class ProviderError extends Error {
  constructor(provider, status, body) {
    super(`${provider} answered ${status}${body?.message ? `: ${body.message}` : ''}`);
    this.status = status;
  }
}

async function call(provider, url, options) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text.slice(0, 200) };
  }
  if (!res.ok) throw new ProviderError(provider, res.status, body);
  return { status: res.status, body };
}

/** Caches an OAuth token until a minute before it expires. */
function tokenCache(fetchToken) {
  let token = null;
  let expiresAt = 0;
  return async () => {
    if (token && Date.now() < expiresAt - 60000) return token;
    const fresh = await fetchToken();
    token = fresh.token;
    expiresAt = Date.now() + fresh.expiresInSec * 1000;
    return token;
  };
}

// ---- MTN MoMo (Collection API: request to pay) ----
// https://momodeveloper.mtn.com/api-documentation : POST /collection/token/, POST /collection/v1_0/requesttopay,
// GET /collection/v1_0/requesttopay/{referenceId}. Rwanda production: X-Target-Environment mtnrwanda.

export function momoProvider(cfg = config) {
  const base = cfg.MOMO_BASE_URL.replace(/\/+$/, '');
  const getToken = tokenCache(async () => {
    const basic = Buffer.from(`${cfg.MOMO_API_USER}:${cfg.MOMO_API_KEY}`).toString('base64');
    const { body } = await call('MTN MoMo', `${base}/collection/token/`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Ocp-Apim-Subscription-Key': cfg.MOMO_SUBSCRIPTION_KEY },
    });
    return { token: body.access_token, expiresInSec: Number(body.expires_in ?? 3600) };
  });
  const headers = async () => ({
    Authorization: `Bearer ${await getToken()}`,
    'X-Target-Environment': cfg.MOMO_TARGET_ENV,
    'Ocp-Apim-Subscription-Key': cfg.MOMO_SUBSCRIPTION_KEY,
  });

  return {
    name: 'mtn_momo',
    currency: cfg.MOMO_CURRENCY,
    async request({ reference, amount, phone, description, callbackUrl }) {
      await call('MTN MoMo', `${base}/collection/v1_0/requesttopay`, {
        method: 'POST',
        headers: {
          ...(await headers()),
          'X-Reference-Id': reference,
          'Content-Type': 'application/json',
          ...(callbackUrl ? { 'X-Callback-Url': callbackUrl } : {}),
        },
        body: JSON.stringify({
          amount: String(amount),
          currency: cfg.MOMO_CURRENCY,
          externalId: reference,
          payer: { partyIdType: 'MSISDN', partyId: phone.replace(/^\+/, '') },
          payerMessage: description.slice(0, 160),
          payeeNote: description.slice(0, 160),
        }),
      });
      return {};
    },
    async status({ reference }) {
      const { body } = await call('MTN MoMo', `${base}/collection/v1_0/requesttopay/${reference}`, { headers: await headers() });
      const map = { SUCCESSFUL: 'successful', FAILED: 'failed', REJECTED: 'failed', TIMEOUT: 'failed', PENDING: 'pending' };
      return {
        status: map[body?.status] ?? 'pending',
        providerTxnId: body?.financialTransactionId,
        amount: body?.amount != null ? Number(body.amount) : undefined,
        reason: typeof body?.reason === 'string' ? body.reason : body?.reason?.message,
      };
    },
  };
}

// ---- Airtel Money (Collection API) ----
// https://developers.airtel.africa : POST /auth/oauth2/token, POST /merchant/v1/payments/,
// GET /standard/v1/payments/{id}. Transaction status TS = success, TF = failed, TA/TIP = in progress.
// Some countries also require message signing (x-signature); check Airtel's current documents for Rwanda.

export function airtelProvider(cfg = config) {
  const base = cfg.AIRTEL_BASE_URL.replace(/\/+$/, '');
  const getToken = tokenCache(async () => {
    const { body } = await call('Airtel Money', `${base}/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: '*/*' },
      body: JSON.stringify({ client_id: cfg.AIRTEL_CLIENT_ID, client_secret: cfg.AIRTEL_CLIENT_SECRET, grant_type: 'client_credentials' }),
    });
    return { token: body.access_token, expiresInSec: Number(body.expires_in ?? 180) };
  });
  const headers = async () => ({
    Authorization: `Bearer ${await getToken()}`,
    'X-Country': cfg.AIRTEL_COUNTRY,
    'X-Currency': cfg.AIRTEL_CURRENCY,
    'Content-Type': 'application/json',
    Accept: '*/*',
  });
  // Airtel wants the number without the country code (e.g. 731234567).
  const local = (phone) => phone.replace(/^\+250/, '');

  return {
    name: 'airtel_money',
    currency: cfg.AIRTEL_CURRENCY,
    async request({ reference, amount, phone }) {
      const { body } = await call('Airtel Money', `${base}/merchant/v1/payments/`, {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({
          reference: 'NexGuard',
          subscriber: { country: cfg.AIRTEL_COUNTRY, currency: cfg.AIRTEL_CURRENCY, msisdn: local(phone) },
          transaction: { amount, country: cfg.AIRTEL_COUNTRY, currency: cfg.AIRTEL_CURRENCY, id: reference },
        }),
      });
      if (body?.status?.success === false) throw new ProviderError('Airtel Money', 400, { message: body.status.message });
      return {};
    },
    async status({ reference }) {
      const { body } = await call('Airtel Money', `${base}/standard/v1/payments/${reference}`, { headers: await headers() });
      const txn = body?.data?.transaction ?? {};
      const map = { TS: 'successful', TF: 'failed', TA: 'pending', TIP: 'pending' };
      return { status: map[txn.status] ?? 'pending', providerTxnId: txn.airtel_money_id, reason: txn.message };
    },
  };
}

// ---- Fake provider: development and tests only ----
// Approves on the first status check. Numbers ending in 13 are declined, numbers ending in 99 never answer.

export function fakeProvider() {
  return {
    name: 'fake',
    currency: 'RWF',
    async request({ phone }) {
      if (phone.endsWith('00')) throw new ProviderError('Fake provider', 400, { message: 'Number not registered for mobile money' });
      return {};
    },
    async status({ reference, phone }) {
      if (phone?.endsWith('99')) return { status: 'pending' };
      if (phone?.endsWith('13')) return { status: 'failed', reason: 'The payer declined' };
      return { status: 'successful', providerTxnId: `fake-${reference.slice(0, 8)}` };
    },
  };
}

/** The providers set up on this server. The fake one is never available in production. */
export function availableProviders(cfg = config) {
  const list = {};
  if (cfg.MOMO_SUBSCRIPTION_KEY && cfg.MOMO_API_USER && cfg.MOMO_API_KEY) list.mtn_momo = momoProvider(cfg);
  if (cfg.AIRTEL_CLIENT_ID && cfg.AIRTEL_CLIENT_SECRET) list.airtel_money = airtelProvider(cfg);
  if (!cfg.isProd) list.fake = fakeProvider();
  return list;
}

/** Which network a Rwandan number belongs to: MTN 078/079, Airtel 072/073. */
export function networkOf(phone) {
  if (/^\+25078|^\+25079/.test(phone)) return 'mtn_momo';
  if (/^\+25072|^\+25073/.test(phone)) return 'airtel_money';
  return null;
}
