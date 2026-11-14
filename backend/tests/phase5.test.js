import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import request from 'supertest';
import mongoose from 'mongoose';
import { app, clearDb, signIn, startDb, stopDb } from './helpers.js';
import { config } from '../src/config.js';
import { User } from '../src/models/User.js';
import { Device } from '../src/models/Device.js';
import { Payment, Subscription } from '../src/models/Billing.js';
import { getProviders, setProviders } from '../src/services/billing.js';
import { airtelProvider, fakeProvider, momoProvider } from '../src/services/paymentProviders.js';
import { expireLapsedPlans } from '../src/services/plans.js';

before(startDb);
after(stopDb);
beforeEach(clearDb);
afterEach(() => setProviders({ fake: fakeProvider() }));

const DAY = 86400 * 1000;

async function person(phone, role) {
  const session = await signIn(phone);
  if (role) await User.updateOne({ phone }, { role });
  return { ...session, phone, as: (req) => req.set('Authorization', `Bearer ${session.accessToken}`) };
}
const checkout = (p, body) => p.as(request(app).post('/api/v1/billing/checkout')).send(body);
const pay = (p, invoiceId, body) => p.as(request(app).post(`/api/v1/billing/invoices/${invoiceId}/pay`)).send(body);
const poll = (p, paymentId) => p.as(request(app).get(`/api/v1/billing/payments/${paymentId}`));

/** Buys the Family plan with the fake provider, which approves on the first check. */
async function buyFamily(p, months = 1) {
  const invoice = (await checkout(p, { plan: 'family', months }).expect(201)).body.invoice;
  const payment = (await pay(p, invoice.id, { provider: 'fake', phone: p.phone }).expect(201)).body.payment;
  return (await poll(p, payment.id)).body;
}

/** A stand-in for MTN or Airtel: records every request and answers from a handler. */
async function fakeProviderServer(handler) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const call = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
    calls.push(call);
    const [status, json] = handler(call);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(json === undefined ? '' : JSON.stringify(json));
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() };
}

describe('plans and payments', () => {
  test('buying the Family plan: a numbered invoice, paid once, with 90 days of history', async () => {
    const owner = await person('+250788000001');
    await owner.as(request(app).post('/api/v1/devices')).send({ name: 'My phone' }).expect(201);

    assert.equal((await checkout(owner, { plan: 'family', months: 2 })).status, 400);
    const invoice = (await checkout(owner, { plan: 'family', months: 3 })).body.invoice;
    assert.match(invoice.number, /^NG-\d{4}-000001$/);
    assert.equal(invoice.total, 3 * config.PRICE_FAMILY_MONTHLY_RWF);
    assert.equal(invoice.status, 'open');

    const payment = (await pay(owner, invoice.id, { provider: 'fake', phone: '0788000001' })).body.payment;
    assert.equal(payment.status, 'pending');
    assert.equal((await pay(owner, invoice.id, { provider: 'fake', phone: '0788000001' })).body.error, 'payment_pending');

    const done = (await poll(owner, payment.id)).body;
    assert.equal(done.payment.status, 'successful');
    assert.equal(done.invoice.status, 'paid');
    const sub = await Subscription.findOne({ plan: 'family' });
    const days = (sub.paidUntil - Date.now()) / DAY;
    assert.ok(days > 88 && days < 93, `paid for ${days} days`);

    // Asking again (or a late callback) does not apply the invoice twice.
    await poll(owner, payment.id);
    assert.equal((await Subscription.findOne({ plan: 'family' })).paidUntil.getTime(), sub.paidUntil.getTime());
    assert.equal((await pay(owner, invoice.id, { provider: 'fake', phone: '0788000001' })).body.error, 'invoice_closed');

    const me = (await owner.as(request(app).get('/api/v1/billing/me'))).body;
    assert.equal(me.family.active, true);
    assert.equal((await owner.as(request(app).get('/api/v1/devices'))).body.devices[0].historyDays, 90);

    // Buying again extends from the current end, not from today.
    await buyFamily(owner, 1);
    const extended = (await Subscription.findOne({ plan: 'family' })).paidUntil;
    assert.ok((extended - sub.paidUntil) / DAY > 27);
  });

  test('declined, refused and unanswered payments leave the invoice open', async () => {
    const owner = await person('+250788000001');
    const invoice = (await checkout(owner, { plan: 'family', months: 1 })).body.invoice;

    const declined = (await pay(owner, invoice.id, { provider: 'fake', phone: '0788000013' })).body.payment;
    const after = (await poll(owner, declined.id)).body;
    assert.equal(after.payment.status, 'failed');
    assert.equal(after.payment.failureReason, 'The payer declined');
    assert.equal(after.invoice.status, 'open');

    const refused = await pay(owner, invoice.id, { provider: 'fake', phone: '0788000100' });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, 'payment_refused');

    const slow = (await pay(owner, invoice.id, { provider: 'fake', phone: '0788000199' })).body.payment;
    assert.equal((await poll(owner, slow.id)).body.payment.status, 'pending');
    // createdAt is read-only through Mongoose: change it in the collection itself.
    await Payment.collection.updateOne({ _id: new mongoose.Types.ObjectId(slow.id) }, { $set: { createdAt: new Date(Date.now() - 16 * 60000) } });
    assert.equal((await poll(owner, slow.id)).body.payment.status, 'expired');

    assert.equal((await pay(owner, invoice.id, { provider: 'mtn_momo', phone: '0788000001' })).body.error, 'provider_unavailable');
    const other = await person('+250788000002');
    assert.equal((await other.as(request(app).get(`/api/v1/billing/payments/${declined.id}`))).status, 404);
  });
});

describe('MTN MoMo and Airtel Money clients', () => {
  test('MTN MoMo: token, request to pay, status; an amount that does not match is refused', async () => {
    let state = 'PENDING';
    let amount = '2000';
    const mtn = await fakeProviderServer((call) => {
      if (call.url === '/collection/token/') return [200, { access_token: 'tok-123', token_type: 'access_token', expires_in: 3600 }];
      if (call.url === '/collection/v1_0/requesttopay' && call.method === 'POST') return [202, undefined];
      if (call.url.startsWith('/collection/v1_0/requesttopay/')) return [200, { amount, currency: 'EUR', financialTransactionId: '987654', externalId: 'x', status: state }];
      return [404, { message: 'no' }];
    });
    const cfg = { ...config, MOMO_BASE_URL: mtn.url, MOMO_SUBSCRIPTION_KEY: 'sub-key', MOMO_API_USER: 'user-id', MOMO_API_KEY: 'api-key', MOMO_TARGET_ENV: 'sandbox', MOMO_CURRENCY: 'EUR' };
    setProviders({ mtn_momo: momoProvider(cfg) });

    const owner = await person('+250788000001');
    const invoice = (await checkout(owner, { plan: 'family', months: 1 })).body.invoice;
    assert.equal((await pay(owner, invoice.id, { provider: 'mtn_momo', phone: '0731234567' })).body.error, 'wrong_network');
    const payment = (await pay(owner, invoice.id, { provider: 'mtn_momo', phone: '0788123456' })).body.payment;

    const [token, rtp] = mtn.calls;
    assert.equal(token.headers.authorization, `Basic ${Buffer.from('user-id:api-key').toString('base64')}`);
    assert.equal(token.headers['ocp-apim-subscription-key'], 'sub-key');
    assert.equal(rtp.headers.authorization, 'Bearer tok-123');
    assert.equal(rtp.headers['x-target-environment'], 'sandbox');
    assert.match(rtp.headers['x-reference-id'], /^[0-9a-f-]{36}$/);
    assert.deepEqual(rtp.body.payer, { partyIdType: 'MSISDN', partyId: '250788123456' });
    assert.equal(rtp.body.amount, '2000');
    assert.equal(rtp.body.currency, 'EUR');

    assert.equal((await poll(owner, payment.id)).body.payment.status, 'pending');
    await Payment.updateOne({ _id: payment.id }, { lastCheckedAt: null });
    state = 'SUCCESSFUL';
    amount = '1500'; // not what the invoice says
    const res = (await poll(owner, payment.id)).body;
    assert.equal(res.payment.status, 'failed');
    assert.equal(res.payment.failureReason, 'Amount does not match the invoice');
    assert.equal(res.invoice.status, 'open');
    assert.equal(mtn.calls.filter((c) => c.url === '/collection/token/').length, 1); // the token is reused
    mtn.close();
  });

  test('Airtel Money: request and status; a callback only triggers a check with Airtel', async () => {
    let status = 'TIP';
    const airtel = await fakeProviderServer((call) => {
      if (call.url === '/auth/oauth2/token') return [200, { access_token: 'air-tok', expires_in: '180', token_type: 'bearer' }];
      if (call.url === '/merchant/v1/payments/') return [200, { data: { transaction: { id: call.body.transaction.id, status: 'Success.' } }, status: { success: true, code: '200' } }];
      if (call.url.startsWith('/standard/v1/payments/')) return [200, { data: { transaction: { id: 'x', status, airtel_money_id: 'AM-55', message: 'ok' } }, status: { success: true } }];
      return [404, {}];
    });
    const cfg = { ...config, AIRTEL_BASE_URL: airtel.url, AIRTEL_CLIENT_ID: 'cid', AIRTEL_CLIENT_SECRET: 'secret' };
    setProviders({ airtel_money: airtelProvider(cfg) });

    const owner = await person('+250788000001');
    const invoice = (await checkout(owner, { plan: 'family', months: 1 })).body.invoice;
    const payment = (await pay(owner, invoice.id, { provider: 'airtel_money', phone: '0731234567' })).body.payment;
    const req = airtel.calls.find((c) => c.url === '/merchant/v1/payments/');
    assert.equal(req.headers['x-country'], 'RW');
    assert.equal(req.headers['x-currency'], 'RWF');
    assert.equal(req.body.subscriber.msisdn, '731234567');
    assert.equal(req.body.transaction.amount, 2000);
    const reference = req.body.transaction.id;

    const callback = (key, body) => request(app).post(`/api/v1/billing/callbacks/airtel_money?key=${key}`).send(body);
    assert.equal((await callback('wrong-key-wrong-key', { transaction: { id: reference, status_code: 'TS' } })).status, 403);
    // A callback that claims success while Airtel still says "in progress" changes nothing.
    await callback(config.paymentCallbackSecret, { transaction: { id: reference, status_code: 'TS' } }).expect(200);
    assert.equal((await Payment.findById(payment.id)).status, 'pending');

    status = 'TS';
    await callback(config.paymentCallbackSecret, { transaction: { id: reference, status_code: 'TS' } }).expect(200);
    const settled = await Payment.findById(payment.id);
    assert.equal(settled.status, 'successful');
    assert.equal(settled.providerTxnId, 'AM-55');
    airtel.close();
  });
});

describe('family sharing', () => {
  test('family members see, ring and locate shared phones; only while the plan lasts', async () => {
    const mum = await person('+250788000001');
    const kid = await person('+250788000002');
    const kidPhone = (await kid.as(request(app).post('/api/v1/devices')).send({ name: 'Kid phone' })).body.device;
    await kid.as(request(app).post('/api/v1/devices')).send({ name: 'Kid tablet' }).expect(201);

    await mum.as(request(app).post('/api/v1/family')).send({ name: 'Uwase family' }).expect(201);
    assert.equal((await mum.as(request(app).post('/api/v1/family/members')).send({ phone: '0788000002' })).status, 402);
    await buyFamily(mum);
    const fam = (await mum.as(request(app).post('/api/v1/family/members')).send({ phone: '0788000002' }).expect(201)).body.family;
    assert.deepEqual(fam.people.map((p) => p.role), ['owner', 'member']);
    assert.equal((await kid.as(request(app).post('/api/v1/family')).send({})).body.error, 'already_in_family');

    // Nothing is shared until the kid chooses.
    assert.equal((await mum.as(request(app).get('/api/v1/devices'))).body.devices.length, 0);
    await kid.as(request(app).patch(`/api/v1/devices/${kidPhone.id}`)).send({ familyShared: true }).expect(200);
    const seen = (await mum.as(request(app).get('/api/v1/devices'))).body.devices;
    assert.deepEqual(seen.map((d) => d.name), ['Kid phone']);
    assert.equal(seen[0].sharedBy, '+250788000002' === kid.user.phone ? (kid.user.name ?? kid.user.phone) : null);

    await mum.as(request(app).post(`/api/v1/devices/${kidPhone.id}/commands`)).send({ type: 'ring' }).expect(201);
    assert.equal((await mum.as(request(app).post(`/api/v1/devices/${kidPhone.id}/commands`)).send({ type: 'lock' })).status, 403);
    assert.equal((await mum.as(request(app).patch(`/api/v1/devices/${kidPhone.id}`)).send({ status: 'lost' })).status, 404);
    assert.equal((await mum.as(request(app).delete(`/api/v1/devices/${kidPhone.id}`))).status, 404);

    // The plan ends (past the grace days): sharing stops, and the longer history goes back to 30 days.
    await mum.as(request(app).post('/api/v1/devices')).send({ name: 'Mum phone' }).expect(201);
    assert.equal((await Device.findOne({ name: 'Mum phone' })).historyDays, undefined); // added after paying
    await buyFamily(mum); // re-applies 90 days to all her phones
    assert.equal((await Device.findOne({ name: 'Mum phone' })).historyDays, 90);
    await Subscription.updateOne({ plan: 'family' }, { paidUntil: new Date(Date.now() - 8 * DAY) });
    assert.equal((await mum.as(request(app).get('/api/v1/devices'))).body.devices.filter((d) => d.sharedBy).length, 0);
    assert.equal(await expireLapsedPlans(), 1);
    assert.equal((await Device.findOne({ name: 'Mum phone' })).historyDays, undefined);

    // A member can leave.
    await kid.as(request(app).delete(`/api/v1/family/members/${kid.user.id}`)).expect(200);
    assert.equal((await kid.as(request(app).get('/api/v1/family'))).body.family, null);
  });
});

describe('organisation laptop seats', () => {
  test('beyond the free laptops an organisation needs seats; extra seats are priced for the days left', async () => {
    const free = config.ORG_FREE_LAPTOPS;
    config.ORG_FREE_LAPTOPS = 1;
    try {
      const head = await person('+250788000001');
      const org = (await head.as(request(app).post('/api/v1/orgs')).send({ name: 'Green Hills Academy', type: 'school' })).body.org;
      const code = () => head.as(request(app).post('/api/v1/devices/pairing-codes')).send({ orgId: org.id });
      const pair = (c) => request(app).post('/api/v1/device/pair').send({ code: c, platform: 'windows' });

      await pair((await code()).body.code).expect(201);
      const blocked = await code();
      assert.equal(blocked.status, 402);
      assert.equal(blocked.body.error, 'seats_needed');

      const invoice = (await checkout(head, { plan: 'org_seats', orgId: org.id, seats: 2, months: 1, billTo: { name: 'Green Hills Academy Ltd', tin: '123456789' } })).body.invoice;
      assert.equal(invoice.total, 2 * config.PRICE_LAPTOP_SEAT_MONTHLY_RWF);
      assert.equal(invoice.billTo.tin, '123456789');
      const payment = (await pay(head, invoice.id, { provider: 'fake', phone: '0788000001' })).body.payment;
      await poll(head, payment.id);

      const me = (await head.as(request(app).get('/api/v1/billing/me'))).body;
      assert.equal(me.orgs[0].seats.limit, 3);
      await pair((await code()).body.code).expect(201);
      await pair((await code()).body.code).expect(201);
      assert.equal((await code()).status, 402);

      const extra = (await checkout(head, { plan: 'org_seats', orgId: org.id, seats: 1, addSeats: true })).body.invoice;
      assert.equal(extra.product.addSeats, true);
      assert.ok(extra.total <= config.PRICE_LAPTOP_SEAT_MONTHLY_RWF + 100 && extra.total > 0);
      const p2 = (await pay(head, extra.id, { provider: 'fake', phone: '0788000001' })).body.payment;
      await poll(head, p2.id);
      assert.equal((await head.as(request(app).get('/api/v1/billing/me'))).body.orgs[0].seats.limit, 4);

      const outsider = await person('+250788000003');
      assert.equal((await outsider.as(request(app).get(`/api/v1/billing/invoices/${invoice.id}`))).status, 404);
      assert.equal((await checkout(outsider, { plan: 'org_seats', orgId: org.id, seats: 1, months: 1 })).status, 404);
    } finally {
      config.ORG_FREE_LAPTOPS = free;
    }
  });
});

describe('the team\'s view and monitoring', () => {
  test('revenue counts only real money toward the gate; metrics are exported', async () => {
    const owner = await person('+250788000001');
    await buyFamily(owner);
    const admin = await person('+250788000009', 'admin');
    const stats = (await admin.as(request(app).get('/api/v1/admin/billing/stats'))).body;
    assert.equal(stats.revenue30d.RWF.total, config.PRICE_FAMILY_MONTHLY_RWF);
    assert.equal(stats.gate.revenue30d, 0); // the fake provider is not real money
    assert.equal(stats.gate.costSet, false);
    assert.equal(stats.active.family, 1);
    assert.equal(stats.recentPayments[0].status, 'successful');
    assert.equal((await owner.as(request(app).get('/api/v1/admin/billing/stats'))).status, 403);

    const metrics = await request(app).get('/metrics');
    assert.equal(metrics.status, 200);
    assert.match(metrics.text, /http_requests_total\{method="POST",route="\/api\/v1\/billing\/checkout",status="201"\} \d+/);
    // Errors keep the full route (Express resets the prefix when an error leaves a router).
    assert.match(metrics.text, /route="\/api\/v1\/devices\/:id\/commands",status="403"/);
    assert.doesNotMatch(metrics.text, /route="\/:id/);
    assert.match(metrics.text, /http_request_duration_seconds_bucket\{method="GET",route="\/api\/v1\/billing\/payments\/:id",le="\+Inf"\}/);
    assert.match(metrics.text, /nexguard_db_up 1/);
    assert.ok(getProviders().fake);
  });
});
