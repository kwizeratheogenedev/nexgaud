import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, clearDb, ownerWithDevice, signIn, startDb, stopDb } from './helpers.js';

before(startDb);
after(stopDb);
beforeEach(clearDb);

/** Opens the device's live feed over real HTTP and collects events until `count` arrive (or 3 s pass). */
async function openFeed(server, deviceId, token) {
  const { port } = server.address();
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/devices/${deviceId}/stream`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const event = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (event) events.push({ event, data: JSON.parse(data) });
        }
      }
    } catch {
      // aborted
    }
  })();
  const waitFor = async (count) => {
    const end = Date.now() + 3000;
    while (events.length < count && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    return events;
  };
  return { status: res.status, type: res.headers.get('content-type'), events, waitFor, close: () => { controller.abort(); return pump; } };
}

describe('live tracking', () => {
  test('the owner starts live mode; the phone sees it in every reply; it ends by itself', async () => {
    const o = await ownerWithDevice('+250788000001');
    const started = await o.owner(request(app).post(`/api/v1/devices/${o.device.id}/live`)).send({});
    assert.equal(started.status, 200);
    const minutes = (new Date(started.body.device.liveUntil) - Date.now()) / 60000;
    assert.ok(minutes > 14 && minutes <= 15);

    const beat = await o.phone(request(app).post('/api/v1/device/heartbeat')).send({ battery: 80 });
    assert.equal(beat.body.liveUntil, started.body.device.liveUntil);
    const upload = await o.phone(request(app).post('/api/v1/device/locations')).send({ points: [{ lat: -1.95, lng: 30.06, recordedAt: new Date().toISOString() }] });
    assert.ok(upload.body.liveUntil);

    assert.equal((await o.owner(request(app).post(`/api/v1/devices/${o.device.id}/live`)).send({ seconds: 3600 })).status, 400);
    const stopped = await o.owner(request(app).post(`/api/v1/devices/${o.device.id}/live`)).send({ stop: true });
    assert.equal(stopped.body.device.liveUntil, null);
    assert.equal((await o.phone(request(app).post('/api/v1/device/heartbeat')).send({})).body.liveUntil, null);

    const stranger = await signIn('+250788000002');
    const res = await request(app).post(`/api/v1/devices/${o.device.id}/live`).set('Authorization', `Bearer ${stranger.accessToken}`).send({});
    assert.equal(res.status, 404);
  });

  test('the live feed pushes new positions and status to the dashboard as they arrive', async () => {
    const o = await ownerWithDevice('+250788000001');
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    try {
      const feed = await openFeed(server, o.device.id, o.accessToken);
      assert.equal(feed.status, 200);
      assert.match(feed.type, /text\/event-stream/);
      await feed.waitFor(1);
      assert.equal(feed.events[0].event, 'hello');
      assert.equal(feed.events[0].data.device.id, o.device.id);

      const t0 = Date.now();
      await o.phone(request(app).post('/api/v1/device/locations')).send({
        points: [
          { lat: -1.9502, lng: 30.0601, accuracyM: 6, source: 'gps', battery: 70, recordedAt: new Date(t0 - 5000).toISOString() },
          { lat: -1.9500, lng: 30.0605, accuracyM: 5, source: 'gps', battery: 70, recordedAt: new Date(t0).toISOString() },
        ],
      }).expect(200);
      await o.owner(request(app).post(`/api/v1/devices/${o.device.id}/live`)).send({ seconds: 120 }).expect(200);

      const events = await feed.waitFor(5);
      const locations = events.filter((e) => e.event === 'location');
      assert.deepEqual(locations.map((e) => e.data.lat), [-1.9502, -1.95]); // oldest first
      assert.equal(locations[1].data.accuracyM, 5);
      const states = events.filter((e) => e.event === 'state');
      assert.ok(states.at(-1).data.liveUntil);
      await feed.close();

      const stranger = await signIn('+250788000002');
      const denied = await openFeed(server, o.device.id, stranger.accessToken);
      assert.equal(denied.status, 404);
      await denied.close();
    } finally {
      server.close();
    }
  });
});
