import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, clearDb, signIn, startDb, stopDb } from './helpers.js';
import { devOutbox } from '../src/services/sms.js';
import { User } from '../src/models/User.js';
import { Upload } from '../src/models/Upload.js';
import { CheckLog } from '../src/models/CheckLog.js';
import { classifyQuery, luhnValid, normalizeSerial, parseImei } from '../src/lib/imei.js';
import { config } from '../src/config.js';

before(startDb);
after(stopDb);
beforeEach(clearDb);

/** A valid IMEI: 14 digits plus the Luhn check digit. */
function imei(base14) {
  for (let d = 0; d <= 9; d++) if (luhnValid(base14 + d)) return base14 + d;
  throw new Error('unreachable');
}
const IMEI_A = imei('35693803564380');
const IMEI_B = imei('35693803564381');
const IMEI_C = imei('86754203112233');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

const smsTo = (phone) => devOutbox.filter((m) => m.to === phone && !/\b\d{6}\b/.test(m.message));
const auth = (session) => (req) => req.set('Authorization', `Bearer ${session.accessToken}`);

async function person(phone, role) {
  const session = await signIn(phone);
  if (role) await User.updateOne({ phone }, { role });
  return { ...session, as: auth(session), phone };
}

async function register(p, body = {}) {
  return p.as(request(app).post('/api/v1/registry/items')).send({ brand: 'TECNO', model: 'Spark 20', imeis: [IMEI_A], ...body });
}

async function reportStolen(p, itemId, body = {}) {
  return p
    .as(request(app).post(`/api/v1/registry/items/${itemId}/reports`))
    .send({ type: 'stolen', incidentAt: new Date().toISOString(), place: 'Nyabugogo', policeCaseNumber: 'RIB/2026/0042', policeStation: 'Nyarugenge', ...body });
}

const check = (q) => request(app).get('/api/v1/check').query({ q });

/** Owner with a registered phone reported stolen and approved by an admin. */
async function stolenSetup() {
  const owner = await person('+250788000001');
  const admin = await person('+250788000009', 'admin');
  const item = (await register(owner)).body.item;
  const report = (await reportStolen(owner, item.id)).body.item.report;
  await admin.as(request(app).post(`/api/v1/admin/registry/reports/${report.id}/review`)).send({ decision: 'approve' }).expect(200);
  return { owner, admin, item, report };
}

describe('IMEI and serial helpers', () => {
  test('valid IMEIs pass; typing mistakes, IMEISVs and placeholders are explained', () => {
    assert.deepEqual(parseImei(`IMEI: ${IMEI_A.slice(0, 8)} ${IMEI_A.slice(8)}`), { imei: IMEI_A });
    const wrong = IMEI_A.slice(0, 14) + ((Number(IMEI_A[14]) + 1) % 10);
    assert.equal(parseImei(wrong).error, 'checksum');
    assert.equal(parseImei('3569380356438090').error, 'imeisv');
    assert.equal(parseImei('000000000000000').error, 'placeholder');
    assert.equal(parseImei('12345').error, 'length');
    assert.equal(normalizeSerial(' c02-xk1 abj '), 'C02XK1ABJ');
    assert.deepEqual(classifyQuery(IMEI_A), { kind: 'imei', value: IMEI_A });
    assert.deepEqual(classifyQuery('R58M12ABCDE'), { kind: 'serial', value: 'R58M12ABCDE' });
    assert.equal(classifyQuery('!!').kind, 'invalid');
  });
});

describe('registering devices', () => {
  test('an IMEI belongs to one person; the second gets a conflict that points to disputes', async () => {
    const a = await person('+250788000001');
    const b = await person('+250788000002');
    const res = await register(a, { imeis: [IMEI_A, IMEI_B], color: 'Blue' });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.item.imeis, [IMEI_A, IMEI_B]);
    assert.equal(res.body.item.status, 'registered');

    assert.equal((await register(a)).body.error, 'already_yours');
    const taken = await register(b, { imeis: [IMEI_B] });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error, 'already_registered');
  });

  test('bad IMEIs are refused with a reason; an IMEI or a serial is required', async () => {
    const a = await person('+250788000001');
    const bad = await register(a, { imeis: ['356938035643801'] });
    assert.equal(bad.status, 400);
    assert.match(Object.values(bad.body.details).flat()[0], /typing mistake/);
    assert.equal((await register(a, { imeis: [] })).status, 400);
    const laptop = await register(a, { kind: 'laptop', brand: 'HP', model: 'ProBook', imeis: [], serial: '5cd-123 4xyz' });
    assert.equal(laptop.status, 201);
    assert.equal(laptop.body.item.serial, '5CD1234XYZ');
  });

  test('proof files: real images only, visible to the owner, not to others', async () => {
    const a = await person('+250788000001');
    const b = await person('+250788000002');
    const item = (await register(a)).body.item;
    const fake = await a
      .as(request(app).post(`/api/v1/registry/items/${item.id}/proofs?kind=receipt`))
      .set('Content-Type', 'image/png')
      .send(Buffer.from('<html><script>alert(1)</script></html>'.padEnd(80)));
    assert.equal(fake.status, 400);
    assert.equal(fake.body.error, 'file_type');

    const ok = await a.as(request(app).post(`/api/v1/registry/items/${item.id}/proofs?kind=box`)).set('Content-Type', 'image/png').send(PNG);
    assert.equal(ok.status, 201);
    assert.equal(ok.body.item.proofStatus, 'submitted');
    const proof = ok.body.item.proofs[0];
    assert.equal(proof.kind, 'box');

    const file = await a.as(request(app).get(`/api/v1/registry/items/${item.id}/proofs/${proof.id}`)).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'image/png');
    assert.match(file.headers['content-security-policy'], /sandbox/);
    assert.ok(file.body.equals(PNG));
    assert.equal((await b.as(request(app).get(`/api/v1/registry/items/${item.id}/proofs/${proof.id}`))).status, 404);
  });
});

describe('stolen reports and the public check', () => {
  test('a stolen report needs a police case number and shows publicly only once approved', async () => {
    const owner = await person('+250788000001');
    const admin = await person('+250788000009', 'admin');
    const item = (await register(owner)).body.item;

    const noCase = await reportStolen(owner, item.id, { policeCaseNumber: undefined });
    assert.equal(noCase.status, 400);
    assert.ok(noCase.body.details.policeCaseNumber);

    const created = await reportStolen(owner, item.id);
    assert.equal(created.status, 201);
    assert.equal(created.body.item.report.status, 'pending');
    assert.equal((await reportStolen(owner, item.id)).status, 409);

    // Pending: the public sees "registered", but the owner already hears about the check.
    assert.equal((await check(IMEI_A)).body.result, 'registered');
    const alerts = await owner.as(request(app).get('/api/v1/alerts'));
    assert.equal(alerts.body.alerts[0].type, 'registry_check');

    const queue = await admin.as(request(app).get('/api/v1/admin/registry/reports'));
    assert.equal(queue.body.reports.length, 1);
    assert.equal(queue.body.reports[0].owner.phone, '+250788000001');
    const reportId = queue.body.reports[0].id;

    assert.equal((await admin.as(request(app).post(`/api/v1/admin/registry/reports/${reportId}/review`)).send({ decision: 'reject' })).status, 400);
    const approved = await admin.as(request(app).post(`/api/v1/admin/registry/reports/${reportId}/review`)).send({ decision: 'approve', proof: 'accepted' });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.item.status, 'stolen');
    assert.match(smsTo('+250788000001').at(-1).message, /was approved/);

    const res = await check(IMEI_A);
    assert.equal(res.body.result, 'stolen');
    assert.deepEqual(res.body.device, { kind: 'phone', brand: 'TECNO', model: 'Spark 20', color: null });
    assert.ok(res.body.reportedOn);
    assert.equal(res.body.police, undefined);
    assert.doesNotMatch(JSON.stringify(res.body), /250788000001|Nyabugogo|RIB/);
    assert.equal((await owner.as(request(app).get('/api/v1/registry/items'))).body.items[0].report.status, 'approved');
  });

  test('unknown and invalid numbers', async () => {
    assert.equal((await check(IMEI_C)).body.result, 'not_registered');
    const invalid = await check('123456789012345');
    assert.equal(invalid.body.result, 'invalid');
    assert.equal(invalid.body.reason, 'checksum');
    assert.equal(await CheckLog.countDocuments({ source: 'web' }), 2);
  });

  test('every check of a stolen phone is an alert; the SMS goes at most once a day', async () => {
    const { owner } = await stolenSetup();
    const before = smsTo(owner.phone).length;
    await check(IMEI_A);
    await check(IMEI_A);
    assert.equal(smsTo(owner.phone).length, before + 1);
    assert.match(smsTo(owner.phone).at(-1).message, /someone checked your reported "TECNO Spark 20" \(web\)/);
    const alerts = await owner.as(request(app).get('/api/v1/alerts'));
    assert.equal(alerts.body.alerts.filter((a) => a.type === 'registry_check').length, 2);
  });

  test('a finder can send the owner a message about a reported phone only', async () => {
    const { owner } = await stolenSetup();
    const tip = await request(app).post('/api/v1/check/tip').send({ q: IMEI_A, message: 'A man is selling it at the bus park', contactPhone: '0788 555 444' });
    assert.equal(tip.status, 201);
    const alerts = await owner.as(request(app).get('/api/v1/alerts'));
    const alert = alerts.body.alerts.find((a) => a.type === 'registry_tip');
    assert.equal(alert.message, 'A man is selling it at the bus park');
    assert.equal(alert.contactPhone, '+250788555444');

    const other = await person('+250788000003');
    await register(other, { imeis: [IMEI_C] });
    assert.equal((await request(app).post('/api/v1/check/tip').send({ q: IMEI_C, message: 'hello there' })).status, 404);
  });

  test('marking it recovered clears the public flag; items with an open report cannot be deleted', async () => {
    const { owner, item } = await stolenSetup();
    assert.equal((await owner.as(request(app).delete(`/api/v1/registry/items/${item.id}`))).status, 409);
    const closed = await owner.as(request(app).post(`/api/v1/registry/items/${item.id}/reports/close`)).send({ reason: 'recovered' });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.item.status, 'registered');
    assert.equal(closed.body.item.report.closedReason, 'recovered');
    assert.equal((await check(IMEI_A)).body.result, 'registered');
    assert.equal((await owner.as(request(app).delete(`/api/v1/registry/items/${item.id}`))).status, 204);
  });
});

describe('selling and disputes', () => {
  test('the buyer claims the device with the seller\'s code; proof files do not move with it', async () => {
    const seller = await person('+250788000001');
    const buyer = await person('+250788000002');
    const item = (await register(seller)).body.item;
    await seller.as(request(app).post(`/api/v1/registry/items/${item.id}/proofs`)).set('Content-Type', 'image/png').send(PNG).expect(201);

    const { code } = (await seller.as(request(app).post(`/api/v1/registry/items/${item.id}/transfer`)).expect(201)).body;
    assert.match(code, /^[A-Z2-9]{8}$/);
    const wrong = await buyer.as(request(app).post('/api/v1/registry/claim')).send({ identifier: IMEI_A, code: 'AAAAAAAA' });
    assert.equal(wrong.body.error, 'transfer_code');

    const claimed = await buyer.as(request(app).post('/api/v1/registry/claim')).send({ identifier: IMEI_A, code });
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.item.proofs.length, 0);
    assert.equal(await Upload.countDocuments(), 0);
    assert.equal((await seller.as(request(app).get('/api/v1/registry/items'))).body.items.length, 0);
    assert.equal((await buyer.as(request(app).get('/api/v1/registry/items'))).body.items.length, 1);
    assert.match(smsTo('+250788000001').at(-1).message, /new owner/);
  });

  test('a stolen phone cannot be handed over', async () => {
    const { owner, item } = await stolenSetup();
    assert.equal((await owner.as(request(app).post(`/api/v1/registry/items/${item.id}/transfer`))).status, 409);
  });

  test('an upheld ownership dispute can give the device to the claimant, and it is all in the audit log', async () => {
    const { admin, item } = await stolenSetup();
    const claimant = await person('+250788000002');
    const opened = await claimant.as(request(app).post('/api/v1/registry/disputes')).send({ identifier: IMEI_A, reason: 'ownership', message: 'I bought it new at a shop in town, I have the receipt.' });
    assert.equal(opened.status, 201);
    await claimant.as(request(app).post(`/api/v1/registry/disputes/${opened.body.dispute.id}/evidence`)).set('Content-Type', 'image/png').send(PNG).expect(201);

    const queue = await admin.as(request(app).get('/api/v1/admin/registry/disputes'));
    assert.equal(queue.body.disputes[0].claimant.phone, '+250788000002');
    assert.equal(queue.body.disputes[0].openReport.status, 'approved');
    assert.equal(queue.body.disputes[0].evidence.length, 1);
    const evidence = await admin.as(request(app).get(`/api/v1/admin/registry/uploads/${queue.body.disputes[0].evidence[0]}`));
    assert.equal(evidence.status, 200);

    const resolved = await admin
      .as(request(app).post(`/api/v1/admin/registry/disputes/${opened.body.dispute.id}/resolve`))
      .send({ outcome: 'upheld', action: 'transfer_item', note: 'Receipt matches the IMEI; the report was a mistake.' });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.item.status, 'registered');
    assert.equal((await claimant.as(request(app).get('/api/v1/registry/items'))).body.items[0].id, item.id);
    assert.equal((await check(IMEI_A)).body.result, 'registered');

    const log = await admin.as(request(app).get('/api/v1/admin/audit'));
    const actions = log.body.entries.map((e) => e.action);
    for (const a of ['item.registered', 'report.created', 'report.approved', 'dispute.opened', 'upload.viewed', 'dispute.upheld']) {
      assert.ok(actions.includes(a), `missing ${a}`);
    }
    assert.equal((await admin.as(request(app).get('/api/v1/admin/audit?action=report'))).body.entries.length, 2);
  });
});

describe('partners', () => {
  async function partnerSetup(type = 'shop') {
    const admin = await person('+250788000009', 'admin');
    const created = await admin.as(request(app).post('/api/v1/admin/partners')).send({ name: 'Kigali Phones', type, district: 'Nyarugenge' });
    assert.equal(created.status, 201);
    const partnerId = created.body.partner.id;
    const added = await admin.as(request(app).post(`/api/v1/admin/partners/${partnerId}/members`)).send({ phone: '0788000005', name: 'Shop Clerk' });
    assert.equal(added.body.partner.members[0].role, type === 'police' ? 'police' : 'shop');
    const member = await person('+250788000005');
    return { admin, partnerId, member };
  }

  test('a shop checks many phones at once, from the portal or with an API key', async () => {
    await stolenSetup();
    const { admin, member, partnerId } = await partnerSetup();
    const outsider = await person('+250788000007');
    assert.equal((await outsider.as(request(app).post('/api/v1/partner/check')).send({ items: [IMEI_A] })).status, 403);

    const bulk = await member.as(request(app).post('/api/v1/partner/check')).send({ items: [IMEI_A, IMEI_C, 'nonsense!'] });
    assert.equal(bulk.status, 200);
    assert.deepEqual(bulk.body.results.map((r) => r.result), ['stolen', 'not_registered', 'invalid']);
    assert.deepEqual(bulk.body.summary, { checked: 3, flagged: 1 });
    assert.equal(bulk.body.results[0].police, undefined);

    const { key } = (await member.as(request(app).post('/api/v1/partner/keys')).send({ name: 'Till system' }).expect(201)).body;
    const viaKey = await request(app).get('/api/v1/partner/check').query({ q: IMEI_A }).set('Authorization', `ApiKey ${key}`);
    assert.equal(viaKey.body.result, 'stolen');
    assert.equal(await CheckLog.countDocuments({ source: 'partner_api' }), 1);
    // A key cannot make more keys.
    assert.equal((await request(app).post('/api/v1/partner/keys').set('Authorization', `ApiKey ${key}`).send({ name: 'x' })).status, 403);

    const history = await member.as(request(app).get('/api/v1/partner/checks'));
    assert.equal(history.body.week.checked, 4);
    assert.equal(history.body.week.flagged, 2);
    assert.equal(history.body.checks.find((c) => c.result === 'stolen').device, 'TECNO Spark 20');

    const keyId = (await member.as(request(app).get('/api/v1/partner/me'))).body.partner.apiKeys[0].id;
    await member.as(request(app).delete(`/api/v1/partner/keys/${keyId}`)).expect(204);
    assert.equal((await request(app).get('/api/v1/partner/check').query({ q: IMEI_A }).set('Authorization', `ApiKey ${key}`)).status, 401);

    const stats = await admin.as(request(app).get('/api/v1/admin/registry/stats'));
    assert.equal(stats.body.gate.activeShops, 1);
    assert.equal(stats.body.gate.target, 5);
    assert.equal(stats.body.partners.find((p) => p.id === partnerId).checks7d, 4);
    assert.equal(stats.body.itemStatuses.stolen, 1);

    await admin.as(request(app).patch(`/api/v1/admin/partners/${partnerId}`)).send({ status: 'suspended' }).expect(200);
    assert.equal((await member.as(request(app).get('/api/v1/partner/me'))).status, 403);
  });

  test('the police see the case number of a reported phone', async () => {
    await stolenSetup();
    const { member } = await partnerSetup('police');
    const res = await member.as(request(app).get('/api/v1/partner/check')).query({ q: IMEI_A });
    assert.deepEqual(res.body.police, { caseNumber: 'RIB/2026/0042', station: 'Nyarugenge', place: 'Nyabugogo' });
  });
});

describe('USSD and SMS checks', () => {
  const ussd = (text, key = config.gatewaySecret) =>
    request(app).post(`/api/v1/gateway/ussd?key=${encodeURIComponent(key)}`).type('form').send({ sessionId: 's1', serviceCode: '*123#', phoneNumber: '+250788111222', text });

  test('the USSD menu walks through language and IMEI to an answer', async () => {
    await stolenSetup();
    assert.match((await ussd('')).text, /^CON NexGuard\n1\. Kinyarwanda/);
    assert.match((await ussd('2')).text, /^CON Enter the phone's IMEI/);
    const answer = await ussd(`1*${IMEI_A}`);
    assert.match(answer.text, /^END YARIBWE: TECNO Spark 20/);
    assert.match((await ussd(`2*${IMEI_C}`)).text, /^END Not in the NexGuard registry/);
    assert.equal((await ussd('', 'wrong-key-wrong-key')).status, 403);
    assert.equal(await CheckLog.countDocuments({ source: 'ussd' }), 2);
  });

  test('an SMS "REBA <IMEI>" gets an SMS answer; anything else gets the instructions', async () => {
    await stolenSetup();
    const sms = (text) =>
      request(app).post(`/api/v1/gateway/sms?key=${config.gatewaySecret}`).type('form').send({ from: '+250788333444', to: '1234', text });
    await sms(`REBA ${IMEI_A}`).expect(200);
    await sms(`check ${IMEI_C}`).expect(200);
    await sms('hello').expect(200);
    const replies = smsTo('+250788333444').map((m) => m.message);
    assert.match(replies[0], /^NexGuard: YARIBWE/);
    assert.match(replies[1], /^NexGuard: Not in the NexGuard registry/);
    assert.match(replies[2], /REBA/);
  });
});
