import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, clearDb, signIn, startDb, stopDb } from './helpers.js';
import { devOutbox } from '../src/services/sms.js';
import { User } from '../src/models/User.js';
import { PairingCode } from '../src/models/PairingCode.js';

before(startDb);
after(stopDb);
beforeEach(clearDb);

const smsTo = (phone) => devOutbox.filter((m) => m.to === phone && !/\b\d{6}\b/.test(m.message));

async function person(phone, role) {
  const session = await signIn(phone);
  if (role) await User.updateOne({ phone }, { role });
  return { ...session, phone, as: (req) => req.set('Authorization', `Bearer ${session.accessToken}`) };
}

const pairCode = (p, body = {}) => p.as(request(app).post('/api/v1/devices/pairing-codes')).send(body);
const pair = (code, body = {}) =>
  request(app).post('/api/v1/device/pair').send({ code, platform: 'windows', hostname: 'LAB-PC-12', osVersion: 'Windows_NT 10.0.26100', appVersion: '0.4.0', ...body });
const asLaptop = (token) => (req) => req.set('Authorization', `Device ${token}`);
const alertsOf = (p) => p.as(request(app).get('/api/v1/alerts')).then((r) => r.body.alerts);

describe('pairing a laptop', () => {
  test('a one-time code pairs the agent; it cannot be used twice or after it expires', async () => {
    const owner = await person('+250788000001');
    const { code, expiresAt } = (await pairCode(owner, { name: 'My ThinkPad' }).expect(201)).body;
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(new Date(expiresAt) > new Date());

    // People type codes in lower case, without the dash.
    const res = await pair(code.replace('-', '').toLowerCase());
    assert.equal(res.status, 201);
    assert.equal(res.body.device.type, 'laptop');
    assert.equal(res.body.device.platform, 'windows');
    assert.equal(res.body.device.name, 'My ThinkPad');
    assert.equal(res.body.device.hostname, 'LAB-PC-12');
    assert.equal(res.body.org, null);
    assert.equal((await pair(code)).body.error, 'pairing_invalid');

    const beat = await asLaptop(res.body.deviceToken)(request(app).post('/api/v1/device/heartbeat')).send({ battery: 70, appVersion: '0.4.0' });
    assert.equal(beat.status, 200);
    const list = await owner.as(request(app).get('/api/v1/devices'));
    assert.equal(list.body.devices[0].battery, 70);

    const second = (await pairCode(owner).expect(201)).body.code;
    await PairingCode.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    assert.equal((await pair(second)).status, 400);
    assert.equal((await pair('ZZZZ-ZZZZ')).status, 400);
  });
});

describe('organisations', () => {
  async function schoolSetup() {
    const head = await person('+250788000001');
    const org = (await head.as(request(app).post('/api/v1/orgs')).send({ name: 'Green Hills Academy', type: 'school', district: 'Gasabo' }).expect(201)).body.org;
    await head.as(request(app).post(`/api/v1/orgs/${org.id}/members`)).send({ phone: '0788000002' }).expect(201);
    const it = await person('+250788000002');
    const { code } = (await pairCode(head, { orgId: org.id, name: 'Lab laptop 12', assignedTo: 'Computer lab' }).expect(201)).body;
    const laptop = (await pair(code)).body;
    return { head, it, org, laptop };
  }

  test('every manager controls the organisation\'s laptops, not each other\'s personal devices', async () => {
    const { head, it, org, laptop } = await schoolSetup();
    assert.equal(laptop.org.name, 'Green Hills Academy');
    assert.equal(laptop.device.orgId, org.id);
    assert.equal(laptop.device.assignedTo, 'Computer lab');

    // The head's personal phone stays private.
    await head.as(request(app).post('/api/v1/devices')).send({ name: 'Head phone' }).expect(201);
    const itDevices = (await it.as(request(app).get('/api/v1/devices'))).body.devices;
    assert.deepEqual(itDevices.map((d) => d.name), ['Lab laptop 12']);
    assert.equal((await head.as(request(app).get('/api/v1/devices'))).body.devices.length, 2);

    const cmd = await it.as(request(app).post(`/api/v1/devices/${laptop.device.id}/commands`)).send({ type: 'ring' });
    assert.equal(cmd.status, 201);
    await it.as(request(app).patch(`/api/v1/devices/${laptop.device.id}`)).send({ assignedTo: 'Library' }).expect(200);

    const me = await asLaptop(laptop.deviceToken)(request(app).get('/api/v1/device/me'));
    assert.equal(me.body.org.name, 'Green Hills Academy');

    // Both managers hear when protection is turned off.
    await asLaptop(laptop.deviceToken)(request(app).post('/api/v1/device/events')).send({ type: 'protection_off' }).expect(201);
    assert.equal((await alertsOf(head)).filter((a) => a.type === 'protection_off').length, 1);
    assert.equal((await alertsOf(it)).filter((a) => a.type === 'protection_off').length, 1);
    assert.equal(smsTo('+250788000002').length, 1);

    const outsider = await person('+250788000003');
    assert.equal((await outsider.as(request(app).get(`/api/v1/devices/${laptop.device.id}`))).status, 404);
    assert.equal((await pairCode(outsider, { orgId: org.id })).status, 404);
  });

  test('a removed manager loses access; the last manager cannot leave', async () => {
    const { head, it, org, laptop } = await schoolSetup();
    const orgs = (await head.as(request(app).get('/api/v1/orgs'))).body.orgs;
    assert.equal(orgs[0].members.length, 2);
    assert.equal(orgs[0].devices, 1);
    await head.as(request(app).delete(`/api/v1/orgs/${org.id}/members/${it.user.id}`)).expect(200);
    assert.equal((await it.as(request(app).get(`/api/v1/devices/${laptop.device.id}`))).status, 404);
    const last = await head.as(request(app).delete(`/api/v1/orgs/${org.id}/members/${head.user.id}`));
    assert.equal(last.body.error, 'last_member');
  });
});

describe('QR tags', () => {
  const scan = (code, query = '') => request(app).get(`/api/v1/tags/public/${code}${query}`);

  async function tagSetup() {
    const owner = await person('+250788000001');
    const { tags } = (await owner.as(request(app).post('/api/v1/tags')).send({ name: 'House keys', kind: 'keys', message: 'Thank you! Please write to me.' }).expect(201)).body;
    return { owner, tag: tags[0] };
  }

  test('a finder sees the item and the message, never the owner; scans alert the owner', async () => {
    const { owner, tag } = await tagSetup();
    assert.match(tag.code, /^[A-Z2-9]{8}$/);
    assert.match(tag.url, new RegExp(`/t/${tag.code}$`));

    const res = await scan(tag.code.toLowerCase());
    assert.deepEqual(res.body.tag, { code: tag.code, status: 'active', name: 'House keys', kind: 'keys', message: 'Thank you! Please write to me.', orgName: null });
    assert.doesNotMatch(JSON.stringify(res.body), /250788000001/);
    await scan(tag.code, '?repeat=1');
    const tags = (await owner.as(request(app).get('/api/v1/tags'))).body.tags;
    assert.equal(tags[0].scans, 1);
    assert.equal((await alertsOf(owner)).filter((a) => a.type === 'tag_scanned').length, 1);
    assert.equal(smsTo(owner.phone).length, 0); // only texted while the item is lost

    await owner.as(request(app).patch(`/api/v1/tags/${tag.id}`)).send({ status: 'lost' }).expect(200);
    assert.equal((await scan(tag.code)).body.tag.status, 'lost');
    assert.match(smsTo(owner.phone).at(-1).message, /"House keys" was just scanned/);
  });

  test('messages are relayed both ways without showing phone numbers', async () => {
    const { owner, tag } = await tagSetup();
    const started = await request(app)
      .post(`/api/v1/tags/public/${tag.code}/threads`)
      .send({ message: 'I found your keys at Kimironko market', contactPhone: '0788 555 444', location: { lat: -1.95, lng: 30.12 }, language: 'rw' });
    assert.equal(started.status, 201);
    const { token } = started.body;
    assert.match(smsTo(owner.phone).at(-1).message, /someone found your "House keys" and wrote: "I found your keys/);

    const threads = (await owner.as(request(app).get('/api/v1/tags/threads/all'))).body.threads;
    assert.equal(threads.length, 1);
    assert.equal(threads[0].finderPhone, null);
    assert.equal(threads[0].finderReachableBySms, true);
    assert.deepEqual(threads[0].messages[0].location, { lat: -1.95, lng: 30.12 });
    assert.equal(threads[0].unread, true);
    assert.equal((await owner.as(request(app).get('/api/v1/tags'))).body.tags[0].unreadThreads, 1);

    const reply = await owner.as(request(app).post(`/api/v1/tags/threads/${threads[0].id}/reply`)).send({ text: 'Thank you! Can you leave them at the market office?' });
    assert.equal(reply.body.texted, true);
    const finderSms = smsTo('+250788555444').at(-1).message;
    assert.match(finderSms, /^NexGuard: nyiri "House keys" wabonye yagusubije/);
    assert.match(finderSms, new RegExp(`/t/${tag.code}$`));
    assert.doesNotMatch(finderSms, /250788000001/);

    const seen = await request(app).get(`/api/v1/tags/public/threads/${token}`);
    assert.deepEqual(seen.body.thread.messages.map((m) => m.from), ['finder', 'owner']);
    await request(app).post(`/api/v1/tags/public/threads/${token}/messages`).send({ text: 'OK, done.' }).expect(201);
    await owner.as(request(app).post(`/api/v1/tags/threads/${threads[0].id}/close`)).expect(200);
    assert.equal((await request(app).post(`/api/v1/tags/public/threads/${token}/messages`).send({ text: 'hello?' })).body.error, 'thread_closed');

    // Turning a tag off makes the sticker say so and deletes its conversations.
    await owner.as(request(app).delete(`/api/v1/tags/${tag.id}`)).expect(204);
    assert.deepEqual((await scan(tag.code)).body.tag, { code: tag.code, status: 'disabled' });
    assert.equal((await request(app).post(`/api/v1/tags/public/${tag.code}/threads`).send({ message: 'hi there' })).status, 404);
    assert.equal((await request(app).get(`/api/v1/tags/public/threads/${token}`)).status, 404);
  });

  test('printed batches: claimed with the claim code beside the QR; organisation tags notify every manager', async () => {
    const admin = await person('+250788000009', 'admin');
    const batch = (await admin.as(request(app).post('/api/v1/admin/tag-batches')).send({ name: 'Kigali Phones, pack of 3', count: 3 }).expect(201)).body.batch;
    const sheet = (await admin.as(request(app).get(`/api/v1/admin/tag-batches/${batch.id}/tags`))).body.tags;
    assert.equal(sheet.length, 3);
    assert.match(sheet[0].claimCode, /^[A-Z2-9]{6}$/);
    assert.deepEqual((await scan(sheet[0].code)).body.tag, { code: sheet[0].code, status: 'unclaimed' });

    const head = await person('+250788000001');
    const org = (await head.as(request(app).post('/api/v1/orgs')).send({ name: 'Green Hills Academy', type: 'school' })).body.org;
    await head.as(request(app).post(`/api/v1/orgs/${org.id}/members`)).send({ phone: '0788000002' }).expect(201);
    const it = await person('+250788000002');

    const claim = (claimCode) =>
      head.as(request(app).post('/api/v1/tags/claim')).send({ code: sheet[0].code, claimCode, name: 'Projector bag', kind: 'bag', orgId: org.id });
    assert.equal((await claim('AAAAAA')).body.error, 'claim_code');
    const claimed = await claim(sheet[0].claimCode.toLowerCase());
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.tag.status, 'active');
    assert.equal((await claim(sheet[0].claimCode)).body.error, 'tag_unavailable');
    assert.equal((await admin.as(request(app).get(`/api/v1/admin/tag-batches/${batch.id}/tags`))).body.tags[0].claimCode, null);
    assert.equal((await admin.as(request(app).get('/api/v1/admin/tag-batches'))).body.batches[0].claimed, 1);

    assert.equal((await scan(sheet[0].code)).body.tag.orgName, 'Green Hills Academy');
    await request(app).post(`/api/v1/tags/public/${sheet[0].code}/threads`).send({ message: 'Found this bag in the hall' }).expect(201);
    assert.equal((await alertsOf(head)).filter((a) => a.type === 'tag_message').length, 1);
    assert.equal((await alertsOf(it)).filter((a) => a.type === 'tag_message').length, 1);
    assert.equal((await it.as(request(app).get('/api/v1/tags'))).body.tags.length, 1);

    const stats = (await admin.as(request(app).get('/api/v1/admin/phase4/stats'))).body;
    assert.equal(stats.gate.tagsInUse, 1);
    assert.equal(stats.gate.tagsTarget, 100);
    assert.equal(stats.tags.statuses.unclaimed, 2);
    assert.equal(stats.gate.passed, false);
  });
});

describe('Phase 4 gate', () => {
  test('counts laptops seen in the last week on each system', async () => {
    const owner = await person('+250788000001');
    for (const platform of ['windows', 'linux']) {
      const { code } = (await pairCode(owner)).body;
      await pair(code, { platform }).expect(201);
    }
    const admin = await person('+250788000009', 'admin');
    const stats = (await admin.as(request(app).get('/api/v1/admin/phase4/stats'))).body;
    assert.equal(stats.laptops.windows.seen7d, 1);
    assert.equal(stats.laptops.linux.seen7d, 1);
    assert.equal(stats.laptops.macos.devices, 0);
    assert.equal(stats.gate.platformsRunning, 2);
    assert.equal(stats.gate.platformsTarget, 3);
    assert.equal((await owner.as(request(app).get('/api/v1/admin/phase4/stats'))).status, 403);
  });
});
