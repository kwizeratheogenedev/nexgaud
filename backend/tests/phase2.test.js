import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, clearDb, ownerWithDevice, signIn, startDb, stopDb } from './helpers.js';
import { devOutbox } from '../src/services/sms.js';
import { Location, LOCATION_RETENTION_DAYS, LOST_RETENTION_DAYS } from '../src/models/Location.js';
import { User } from '../src/models/User.js';
import { Alert } from '../src/models/Alert.js';

before(startDb);
after(stopDb);
beforeEach(clearDb);

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const smsTo = (phone) => devOutbox.filter((m) => m.to === phone && !/\b\d{6}\b/.test(m.message));
const beat = (o, body) => o.phone(request(app).post('/api/v1/device/heartbeat')).send(body);
const event = (o, body) => o.phone(request(app).post('/api/v1/device/events')).send(body);
const alerts = (o, query = '') => o.owner(request(app).get(`/api/v1/alerts${query}`));
const daysFromNow = (date) => (new Date(date).getTime() - Date.now()) / 86400000;

describe('SIM change alert', () => {
  test('the first SIM sets the baseline; a different SIM alerts the owner by SMS', async () => {
    const o = await ownerWithDevice('+250788000001');
    await beat(o, { simFingerprint: 'aaa' }).expect(200);
    assert.equal((await alerts(o)).body.alerts.length, 0);

    await beat(o, { simFingerprint: 'aaa' }).expect(200);
    await beat(o, { simFingerprint: 'bbb' }).expect(200);

    const res = await alerts(o);
    assert.equal(res.body.alerts.length, 1);
    assert.equal(res.body.alerts[0].type, 'sim_changed');
    assert.equal(res.body.alerts[0].smsSent, true);
    assert.equal(res.body.unread, 1);
    assert.match(smsTo('+250788000001')[0].message, /different SIM card was put in "My Tecno"/);

    const dev = await o.owner(request(app).get(`/api/v1/devices/${o.device.id}`));
    assert.ok(dev.body.device.simChangedAt);
  });

  test('removing the SIM gives its own alert; heartbeats without a fingerprint change nothing', async () => {
    const o = await ownerWithDevice('+250788000001');
    await beat(o, { simFingerprint: 'aaa' });
    await beat(o, { battery: 50 });
    await beat(o, { simFingerprint: 'no-sim' });
    const res = await alerts(o);
    assert.deepEqual(res.body.alerts.map((a) => a.type), ['sim_removed']);
  });

  test('the SMS is in the owner\'s language and sent at most once an hour per alert type', async () => {
    const o = await ownerWithDevice('+250788000001');
    await User.updateOne({ phone: '+250788000001' }, { language: 'fr' });
    await beat(o, { simFingerprint: 'aaa' });
    await beat(o, { simFingerprint: 'bbb' });
    await beat(o, { simFingerprint: 'ccc' });

    const sms = smsTo('+250788000001');
    assert.equal(sms.length, 1);
    assert.match(sms[0].message, /une autre carte SIM/);
    const res = await alerts(o);
    assert.equal(res.body.alerts.length, 2); // both recorded, only the first texted
    assert.deepEqual(res.body.alerts.map((a) => a.smsSent), [false, true]);
  });
});

describe('events from the phone', () => {
  test('low battery saves the last location; no SMS unless the phone is lost', async () => {
    const o = await ownerWithDevice('+250788000001');
    const res = await event(o, {
      type: 'low_battery',
      battery: 4,
      location: { lat: -1.95, lng: 30.06, accuracyM: 20, recordedAt: minutesAgo(1) },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.alert.type, 'low_battery');
    assert.equal(res.body.alert.location.lat, -1.95);
    assert.equal(res.body.alert.smsSent, false);
    assert.equal(res.body.status, 'normal');

    const dev = await o.owner(request(app).get(`/api/v1/devices/${o.device.id}`));
    assert.equal(dev.body.device.lastLocation.lat, -1.95);
    assert.equal(dev.body.device.battery, 4);
    assert.equal(smsTo('+250788000001').length, 0);

    await o.owner(request(app).patch(`/api/v1/devices/${o.device.id}`)).send({ status: 'lost' }).expect(200);
    const lost = await event(o, { type: 'low_battery', battery: 3 });
    assert.equal(lost.body.alert.smsSent, true);
  });

  test('protection turned off always texts the owner', async () => {
    const o = await ownerWithDevice('+250788000001');
    const res = await event(o, { type: 'protection_off' });
    assert.equal(res.body.alert.smsSent, true);
    assert.match(smsTo('+250788000001')[0].message, /protection was turned off/);
  });

  test('unknown event types are refused', async () => {
    const o = await ownerWithDevice('+250788000001');
    const res = await event(o, { type: 'sim_changed' }); // only the API decides this one
    assert.equal(res.status, 400);
  });
});

describe('alerts', () => {
  test('owners mark alerts read, and never see another owner\'s alerts', async () => {
    const a = await ownerWithDevice('+250788000001');
    const b = await ownerWithDevice('+250788000002');
    await event(a, { type: 'admin_off' });
    await event(a, { type: 'pin_failed' });
    await event(b, { type: 'admin_off' });

    const mine = await alerts(a);
    assert.equal(mine.body.alerts.length, 2);
    assert.ok(mine.body.alerts.every((x) => x.deviceId === a.device.id));

    const first = mine.body.alerts[0].id;
    const read = await a.owner(request(app).post('/api/v1/alerts/read')).send({ ids: [first] });
    assert.equal(read.body.updated, 1);
    assert.equal((await alerts(a, '?unread=true')).body.alerts.length, 1);

    // B cannot mark A's alerts read.
    const other = await b.owner(request(app).post('/api/v1/alerts/read')).send({ ids: [mine.body.alerts[1].id] });
    assert.equal(other.body.updated, 0);

    await a.owner(request(app).post('/api/v1/alerts/read')).send({});
    assert.equal((await alerts(a)).body.unread, 0);
    assert.equal((await alerts(b)).body.unread, 1);
  });

  test('deleting a device deletes its alerts', async () => {
    const o = await ownerWithDevice('+250788000001');
    await event(o, { type: 'admin_off' });
    await o.owner(request(app).delete(`/api/v1/devices/${o.device.id}`)).expect(204);
    assert.equal(await Alert.countDocuments(), 0);
  });
});

describe('lost mode', () => {
  test('the owner\'s message and contact number reach the phone, and go away when found', async () => {
    const o = await ownerWithDevice('+250788000001');
    const patch = await o
      .owner(request(app).patch(`/api/v1/devices/${o.device.id}`))
      .send({ status: 'lost', lostMessage: 'Please return this phone', contactPhone: '+250 788 999 000' });
    assert.equal(patch.status, 200);
    assert.equal(patch.body.device.lostMode.message, 'Please return this phone');

    const hb = await beat(o, {});
    assert.equal(hb.body.status, 'lost');
    assert.equal(hb.body.lostMode.contactPhone, '+250 788 999 000');

    // Changing only the message keeps the start time.
    const since = hb.body.lostMode.since;
    await o.owner(request(app).patch(`/api/v1/devices/${o.device.id}`)).send({ lostMessage: 'Reward offered' });
    const again = await beat(o, {});
    assert.equal(again.body.lostMode.message, 'Reward offered');
    assert.equal(again.body.lostMode.since, since);

    await o.owner(request(app).patch(`/api/v1/devices/${o.device.id}`)).send({ status: 'recovered' }).expect(200);
    const found = await beat(o, {});
    assert.equal(found.body.status, 'recovered');
    assert.equal(found.body.lostMode, null);
  });

  test('a bad contact number is refused', async () => {
    const o = await ownerWithDevice('+250788000001');
    const res = await o
      .owner(request(app).patch(`/api/v1/devices/${o.device.id}`))
      .send({ status: 'lost', contactPhone: 'call me' });
    assert.equal(res.status, 400);
  });

  test('history of a lost phone is kept for a year, and back to 30 days when found', async () => {
    const o = await ownerWithDevice('+250788000001');
    await o
      .phone(request(app).post('/api/v1/device/locations'))
      .send({ points: [{ lat: -1.94, lng: 30.06, recordedAt: minutesAgo(5) }] })
      .expect(200);
    let point = await Location.findOne().lean();
    assert.ok(Math.abs(daysFromNow(point.expiresAt) - LOCATION_RETENTION_DAYS) < 0.01);

    await o.owner(request(app).patch(`/api/v1/devices/${o.device.id}`)).send({ status: 'lost' });
    point = await Location.findOne().lean();
    assert.ok(Math.abs(daysFromNow(point.expiresAt) - LOST_RETENTION_DAYS) < 0.01);

    // New points while lost are kept a year too.
    await o
      .phone(request(app).post('/api/v1/device/locations'))
      .send({ points: [{ lat: -1.95, lng: 30.07, recordedAt: minutesAgo(1) }] });
    const newest = await Location.findOne().sort({ recordedAt: -1 }).lean();
    assert.ok(daysFromNow(newest.expiresAt) > 360);

    await o.owner(request(app).patch(`/api/v1/devices/${o.device.id}`)).send({ status: 'recovered' });
    const all = await Location.find().lean();
    assert.ok(all.every((p) => daysFromNow(p.expiresAt) < 31));
  });
});

describe('pilot statistics', () => {
  test('only admins can read them', async () => {
    const o = await ownerWithDevice('+250788000001');
    const res = await o.owner(request(app).get('/api/v1/admin/stats'));
    assert.equal(res.status, 403);
  });

  test('counts devices seen in the last 24 hours, by brand, with no personal data', async () => {
    const a = await ownerWithDevice('+250788000001');
    await ownerWithDevice('+250788000002');
    await beat(a, { permissions: { location: 'while_in_use', batteryOptimized: true } });
    // Make the second phone quiet for two days.
    const { Device } = await import('../src/models/Device.js');
    await Device.updateOne({ _id: { $ne: a.device.id } }, { lastSeenAt: new Date(Date.now() - 2 * 86400000) });

    await signIn('+250788000009', 'Team');
    await User.updateOne({ phone: '+250788000009' }, { role: 'admin' });
    const admin = await signIn('+250788000009'); // new token after the role change
    const res = await request(app).get('/api/v1/admin/stats').set('Authorization', `Bearer ${admin.accessToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.users, 2);
    assert.equal(res.body.devices, 2);
    assert.equal(res.body.seen24h, 1);
    assert.equal(res.body.seenPct, 50);
    assert.equal(res.body.pilotGate.passed, false);
    assert.deepEqual(res.body.byBrand, [{ brand: 'tecno', devices: 2, seen24h: 1, seenPct: 50 }]);
    assert.equal(res.body.permissionIssues.locationNotAlways, 2);
    assert.equal(res.body.permissionIssues.batteryOptimized, 1);
    assert.equal(res.body.quietDevices.length, 1);
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('+250788'), 'no phone numbers');
    assert.ok(!text.includes('lastLocation'), 'no locations');
  });
});
