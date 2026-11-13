import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, clearDb, ownerWithDevice, startDb, stopDb } from './helpers.js';
import { Device } from '../src/models/Device.js';
import { Command } from '../src/models/Command.js';

before(startDb);
after(stopDb);
beforeEach(clearDb);

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

describe('pairing', () => {
  test('pairing returns a device token once and stores only its hash', async () => {
    const o = await ownerWithDevice('+250788000001');
    assert.ok(o.deviceToken.length >= 40);
    const stored = await Device.findById(o.device.id).lean();
    assert.notEqual(stored.tokenHash, o.deviceToken);
    assert.ok(!JSON.stringify(o.device).includes('tokenHash'));
  });

  test('a wrong device token is refused', async () => {
    const res = await request(app).get('/api/v1/device/me').set('Authorization', 'Device nope');
    assert.equal(res.status, 401);
  });

  test('a user token cannot call device routes', async () => {
    const o = await ownerWithDevice('+250788000001');
    const res = await request(app).get('/api/v1/device/me').set('Authorization', `Bearer ${o.accessToken}`);
    assert.equal(res.status, 401);
  });
});

describe('locations', () => {
  test('uploaded points update the last location and appear in history', async () => {
    const o = await ownerWithDevice('+250788000001');
    const up = await o
      .phone(request(app).post('/api/v1/device/locations'))
      .send({
        points: [
          { lat: -1.9441, lng: 30.0619, accuracyM: 12, source: 'gps', battery: 80, recordedAt: minutesAgo(10) },
          { lat: -1.95, lng: 30.07, accuracyM: 8, source: 'gps', battery: 78, recordedAt: minutesAgo(2) },
        ],
      });
    assert.equal(up.status, 200);
    assert.equal(up.body.accepted, 2);
    assert.deepEqual(up.body.commands, []);

    const dev = await o.owner(request(app).get(`/api/v1/devices/${o.device.id}`));
    assert.equal(dev.body.device.lastLocation.lat, -1.95);
    assert.equal(dev.body.device.lastLocation.lng, 30.07);
    assert.equal(dev.body.device.battery, 78);

    const hist = await o.owner(request(app).get(`/api/v1/devices/${o.device.id}/locations`));
    assert.equal(hist.status, 200);
    assert.equal(hist.body.points.length, 2);
    assert.equal(hist.body.points[0].lat, -1.9441); // oldest first, for drawing the route
  });

  test('an older batch arriving late does not overwrite a newer last location', async () => {
    const o = await ownerWithDevice('+250788000001');
    await o.phone(request(app).post('/api/v1/device/locations')).send({
      points: [{ lat: -1.95, lng: 30.07, recordedAt: minutesAgo(1) }],
    });
    await o.phone(request(app).post('/api/v1/device/locations')).send({
      points: [{ lat: -2.5, lng: 29.7, recordedAt: minutesAgo(60) }],
    });
    const dev = await o.owner(request(app).get(`/api/v1/devices/${o.device.id}`));
    assert.equal(dev.body.device.lastLocation.lat, -1.95);
  });

  test('points far in the future are rejected, invalid coordinates fail validation', async () => {
    const o = await ownerWithDevice('+250788000001');
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const res = await o.phone(request(app).post('/api/v1/device/locations')).send({
      points: [
        { lat: -1.95, lng: 30.07, recordedAt: future },
        { lat: -1.95, lng: 30.07, recordedAt: minutesAgo(1) },
      ],
    });
    assert.equal(res.body.accepted, 1);
    assert.equal(res.body.rejected, 1);

    const bad = await o.phone(request(app).post('/api/v1/device/locations')).send({
      points: [{ lat: 200, lng: 30, recordedAt: minutesAgo(1) }],
    });
    assert.equal(bad.status, 400);
  });

  test('history ranges longer than 7 days are refused', async () => {
    const o = await ownerWithDevice('+250788000001');
    const res = await o.owner(
      request(app).get(`/api/v1/devices/${o.device.id}/locations?from=2026-01-01&to=2026-02-01`),
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'range_too_long');
  });
});

describe('privacy between accounts', () => {
  test('another user cannot see, command or delete my device', async () => {
    const me = await ownerWithDevice('+250788000001');
    const other = await ownerWithDevice('+250788000002');
    const id = me.device.id;
    for (const req of [
      other.owner(request(app).get(`/api/v1/devices/${id}`)),
      other.owner(request(app).get(`/api/v1/devices/${id}/locations`)),
      other.owner(request(app).post(`/api/v1/devices/${id}/commands`)).send({ type: 'ring' }),
      other.owner(request(app).delete(`/api/v1/devices/${id}`)),
    ]) {
      assert.equal((await req).status, 404);
    }
    const list = await other.owner(request(app).get('/api/v1/devices'));
    assert.deepEqual(
      list.body.devices.map((d) => d.id),
      [other.device.id],
    );
  });
});

describe('commands', () => {
  test('ring: owner sends it, the phone receives it on upload, acknowledges, owner sees done', async () => {
    const o = await ownerWithDevice('+250788000001');
    const sent = await o.owner(request(app).post(`/api/v1/devices/${o.device.id}/commands`)).send({ type: 'ring' });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.command.status, 'queued');
    assert.equal(sent.body.command.pushed, false); // no Firebase configured in tests

    const up = await o.phone(request(app).post('/api/v1/device/locations')).send({
      points: [{ lat: -1.95, lng: 30.07, recordedAt: minutesAgo(1) }],
    });
    assert.equal(up.body.commands.length, 1);
    assert.equal(up.body.commands[0].type, 'ring');
    const cmdId = up.body.commands[0].id;

    const ack = await o
      .phone(request(app).post(`/api/v1/device/commands/${cmdId}/ack`))
      .send({ status: 'done', result: 'Rang for 30 seconds' });
    assert.equal(ack.status, 200);

    const list = await o.owner(request(app).get(`/api/v1/devices/${o.device.id}/commands`));
    assert.equal(list.body.commands[0].status, 'done');
    assert.equal(list.body.commands[0].result, 'Rang for 30 seconds');

    // Once done, it is no longer handed to the phone.
    const again = await o.phone(request(app).get('/api/v1/device/commands'));
    assert.deepEqual(again.body.commands, []);
  });

  test('a newer command of the same type replaces a queued one', async () => {
    const o = await ownerWithDevice('+250788000001');
    await o.owner(request(app).post(`/api/v1/devices/${o.device.id}/commands`)).send({ type: 'ring' });
    await o.owner(request(app).post(`/api/v1/devices/${o.device.id}/commands`)).send({ type: 'ring' });
    const pending = await o.phone(request(app).get('/api/v1/device/commands'));
    assert.equal(pending.body.commands.length, 1);
  });

  test('commands the phone never answers expire after 24 hours', async () => {
    const o = await ownerWithDevice('+250788000001');
    const sent = await o.owner(request(app).post(`/api/v1/devices/${o.device.id}/commands`)).send({ type: 'lock' });
    await Command.updateOne({ _id: sent.body.command.id }, { expiresAt: new Date(Date.now() - 1000) });
    const pending = await o.phone(request(app).get('/api/v1/device/commands'));
    assert.deepEqual(pending.body.commands, []);
    const list = await o.owner(request(app).get(`/api/v1/devices/${o.device.id}/commands`));
    assert.equal(list.body.commands[0].status, 'expired');
  });

  test('a phone cannot acknowledge another phone\'s command', async () => {
    const a = await ownerWithDevice('+250788000001');
    const b = await ownerWithDevice('+250788000002');
    const sent = await a.owner(request(app).post(`/api/v1/devices/${a.device.id}/commands`)).send({ type: 'ring' });
    const res = await b
      .phone(request(app).post(`/api/v1/device/commands/${sent.body.command.id}/ack`))
      .send({ status: 'done' });
    assert.equal(res.status, 404);
  });

  test('a message command needs the message text', async () => {
    const o = await ownerWithDevice('+250788000001');
    const res = await o.owner(request(app).post(`/api/v1/devices/${o.device.id}/commands`)).send({ type: 'message' });
    assert.equal(res.status, 400);
  });
});

describe('heartbeat and lost mode', () => {
  test('heartbeat stores battery and permissions; marking lost shows on the phone', async () => {
    const o = await ownerWithDevice('+250788000001');
    await o
      .phone(request(app).post('/api/v1/device/heartbeat'))
      .send({ battery: 41, charging: false, network: 'cellular', permissions: { location: 'always', notifications: true } })
      .expect(200);
    await o.phone(request(app).post('/api/v1/device/heartbeat')).send({ permissions: { deviceAdmin: true } });

    const dev = await o.owner(request(app).get(`/api/v1/devices/${o.device.id}`));
    assert.equal(dev.body.device.battery, 41);
    assert.equal(dev.body.device.permissions.location, 'always');
    assert.equal(dev.body.device.permissions.deviceAdmin, true);

    await o.owner(request(app).patch(`/api/v1/devices/${o.device.id}`)).send({ status: 'lost' }).expect(200);
    const hb = await o.phone(request(app).post('/api/v1/device/heartbeat')).send({});
    assert.equal(hb.body.status, 'lost');
  });

  test('deleting a device unpairs it', async () => {
    const o = await ownerWithDevice('+250788000001');
    await o.owner(request(app).delete(`/api/v1/devices/${o.device.id}`)).expect(204);
    const res = await o.phone(request(app).get('/api/v1/device/me'));
    assert.equal(res.status, 401);
  });
});
