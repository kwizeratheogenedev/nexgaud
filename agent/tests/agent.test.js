import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Agent } from '../src/agent.js';

/** A stand-in for the NexGuard API: answers check-ins with whatever the test queues. */
async function fakeApi() {
  const calls = [];
  const queue = { commands: [], status: 'normal', lostMode: null, liveUntil: null };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = body ? JSON.parse(body) : null;
    calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: json });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/ack')) {
      queue.commands = queue.commands.filter((c) => !req.url.includes(c.id));
      return res.end(JSON.stringify({ command: {} }));
    }
    res.end(JSON.stringify({ status: queue.status, lostMode: queue.lostMode, liveUntil: queue.liveUntil, commands: queue.commands }));
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://127.0.0.1:${server.address().port}/api/v1`, calls, queue, close: () => server.close() };
}

function fakePlatform(overrides = {}) {
  const did = [];
  return {
    did,
    name: 'windows',
    osVersion: 'Windows_NT 10.0',
    locationSupported: true,
    lock: async () => did.push('lock'),
    ring: async (s) => did.push(`ring ${s}`),
    message: async (t) => did.push(`message ${t}`),
    location: async () => ({ lat: -1.95, lng: 30.06, accuracyM: 30, source: 'network' }),
    battery: async () => ({ battery: 80, charging: false }),
    ...overrides,
  };
}

test('checks in, runs each command once and acknowledges it', async () => {
  const api = await fakeApi();
  const platform = fakePlatform();
  let now = 1_000_000;
  const agent = new Agent({ apiUrl: api.url, token: 'tok', platform, now: () => now });
  api.queue.commands = [
    { id: 'c1', type: 'ring', payload: { durationSec: 10 } },
    { id: 'c2', type: 'lock', payload: {} },
    { id: 'c3', type: 'message', payload: { message: 'Please call me', contactPhone: '0788 123 456' } },
  ];
  await agent.tick();
  assert.deepEqual(platform.did, ['ring 10', 'lock', 'message Please call me\nCall: 0788 123 456']);
  const beat = api.calls.find((c) => c.url === '/api/v1/device/heartbeat');
  assert.equal(beat.auth, 'Device tok');
  assert.equal(beat.body.battery, 80);
  const acks = api.calls.filter((c) => c.url.endsWith('/ack'));
  assert.deepEqual(acks.map((a) => a.body.status), ['done', 'done', 'done']);
  // The first round also sends a location.
  assert.equal(api.calls.filter((c) => c.url === '/api/v1/device/locations').length, 1);

  // Next round: nothing repeats, and no location until 15 minutes have passed.
  now += 60_000;
  await agent.tick();
  assert.equal(platform.did.length, 3);
  assert.equal(api.calls.filter((c) => c.url === '/api/v1/device/locations').length, 1);
  api.close();
});

test('locate sends a fresh location; a failing command is reported as failed', async () => {
  const api = await fakeApi();
  const platform = fakePlatform({ lock: async () => { throw new Error('no session'); } });
  const agent = new Agent({ apiUrl: api.url, token: 'tok', platform });
  agent.lastLocationAt = Date.now(); // a location was just sent
  api.queue.commands = [{ id: 'l1', type: 'locate', payload: {} }, { id: 'k1', type: 'lock', payload: {} }];
  await agent.tick();
  const uploads = api.calls.filter((c) => c.url === '/api/v1/device/locations');
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].body.points[0].lat, -1.95);
  const acks = Object.fromEntries(api.calls.filter((c) => c.url.endsWith('/ack')).map((a) => [a.url.split('/').at(-2), a.body]));
  assert.equal(acks.l1.status, 'done');
  assert.equal(acks.k1.status, 'failed');
  assert.match(acks.k1.result, /no session/);
  api.close();
});

test('lost mode shows the owner\'s message once, and again only if marked lost anew', async () => {
  const api = await fakeApi();
  const platform = fakePlatform({ locationSupported: false });
  const agent = new Agent({ apiUrl: api.url, token: 'tok', platform });
  api.queue.status = 'lost';
  api.queue.lostMode = { message: 'This laptop belongs to Green Hills Academy', contactPhone: '0788000001', since: '2026-11-14T10:00:00Z' };
  await agent.tick();
  await agent.tick();
  assert.deepEqual(platform.did, ['message This laptop belongs to Green Hills Academy\nCall: 0788000001']);
  assert.equal(agent.lost, true);

  api.queue.status = 'normal';
  api.queue.lostMode = null;
  await agent.tick();
  api.queue.status = 'lost';
  api.queue.lostMode = { message: 'Lost again', since: '2026-11-15T10:00:00Z' };
  await agent.tick();
  assert.equal(platform.did.length, 2);
  // Without location (macOS), locate fails clearly instead of hanging.
  api.queue.commands = [{ id: 'x', type: 'locate', payload: {} }];
  await agent.tick();
  const ack = api.calls.find((c) => c.url.endsWith('/x/ack'));
  assert.equal(ack.body.status, 'failed');
  api.close();
});

test('live tracking: a location every 10 seconds until it ends', async () => {
  const api = await fakeApi();
  const platform = fakePlatform();
  let now = 1_000_000;
  const agent = new Agent({ apiUrl: api.url, token: 'tok', platform, now: () => now });
  const uploads = () => api.calls.filter((c) => c.url === '/api/v1/device/locations').length;
  await agent.tick(); // first round sends a location
  assert.equal(uploads(), 1);

  api.queue.liveUntil = new Date(now + 60_000).toISOString();
  now += 10_000;
  await agent.tick();
  assert.equal(agent.live, true);
  assert.equal(uploads(), 2);
  now += 10_000;
  await agent.tick();
  assert.equal(uploads(), 3);

  // Live ends: back to one location every 15 minutes.
  api.queue.liveUntil = null;
  now += 10_000;
  await agent.tick();
  now += 10_000;
  await agent.tick();
  assert.equal(agent.live, false);
  assert.equal(uploads(), 3);
  api.close();
});
