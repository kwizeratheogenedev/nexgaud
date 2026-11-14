/**
 * Load test: how many phones can one API process serve?
 *   npm run loadtest -- [--devices 2000] [--seconds 30] [--concurrency 100]
 *
 * Starts the real API with an in-memory MongoDB (like demo mode), creates simulated devices,
 * then sends what phones send: heartbeats (70%), location uploads (25%) and public IMEI checks (5%).
 * Rate limits are off for the test (they would stop it after 300 requests).
 *
 * A phone checks in about every 5 minutes, so N requests per second ≈ N × 300 phones.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const DEVICES = arg('devices', 2000);
const SECONDS = arg('seconds', 30);
const CONCURRENCY = arg('concurrency', 100);

process.env.NODE_ENV = 'test'; // turns the rate limits off
process.env.LOG_LEVEL = 'silent';
const cacheDir = fileURLToPath(new URL('../node_modules/.cache/mongodb-memory-server/', import.meta.url));
const cached = existsSync(cacheDir) && readdirSync(cacheDir).find((f) => /^mongod-.*?(\.exe)?$/.test(f) && !f.endsWith('.md5'));
if (cached && !process.env.MONGOMS_SYSTEM_BINARY) process.env.MONGOMS_SYSTEM_BINARY = join(cacheDir, cached);

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('nexguard-load');
const mongoose = (await import('mongoose')).default;
await mongoose.connect(process.env.MONGODB_URI);
await mongoose.connection.syncIndexes();
const { createApp } = await import('../src/app.js');
const { User } = await import('../src/models/User.js');
const { Device } = await import('../src/models/Device.js');
const { hmac, randomToken } = await import('../src/lib/crypto.js');

const server = createApp().listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/api/v1`;

console.log(`Creating ${DEVICES} devices…`);
const owners = await User.insertMany(Array.from({ length: Math.ceil(DEVICES / 2) }, (_, i) => ({ phone: `+25078${String(i).padStart(7, '0')}` })));
const tokens = Array.from({ length: DEVICES }, () => randomToken());
await Device.insertMany(
  tokens.map((t, i) => ({ ownerId: owners[i % owners.length]._id, name: `Load ${i}`, brand: 'TECNO', tokenHash: hmac(t), lastSeenAt: new Date() })),
);

const latencies = { heartbeat: [], locations: [], check: [] };
let errors = 0;
const statusCounts = {};
const deadline = Date.now() + SECONDS * 1000;

async function one() {
  const token = tokens[Math.floor(Math.random() * tokens.length)];
  const r = Math.random();
  const kind = r < 0.7 ? 'heartbeat' : r < 0.95 ? 'locations' : 'check';
  const headers = { Authorization: `Device ${token}`, 'Content-Type': 'application/json' };
  const start = performance.now();
  let res;
  if (kind === 'heartbeat') {
    res = await fetch(`${base}/device/heartbeat`, { method: 'POST', headers, body: JSON.stringify({ battery: 50, network: 'cellular', simFingerprint: 'sim-a' }) });
  } else if (kind === 'locations') {
    const point = { lat: -1.95 + Math.random() / 100, lng: 30.06 + Math.random() / 100, accuracyM: 15, source: 'gps', battery: 50, recordedAt: new Date().toISOString() };
    res = await fetch(`${base}/device/locations`, { method: 'POST', headers, body: JSON.stringify({ points: [point] }) });
  } else {
    res = await fetch(`${base}/check?q=356938035643809`);
  }
  await res.arrayBuffer();
  latencies[kind].push(performance.now() - start);
  statusCounts[res.status] = (statusCounts[res.status] ?? 0) + 1;
  if (!res.ok) errors++;
}

async function worker() {
  while (Date.now() < deadline) {
    try {
      await one();
    } catch {
      errors++;
    }
  }
}

console.log(`Running for ${SECONDS} s with ${CONCURRENCY} requests at a time…`);
const started = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const elapsed = (Date.now() - started) / 1000;

const pct = (list, p) => {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const total = Object.values(latencies).reduce((n, l) => n + l.length, 0);
const rps = total / elapsed;
console.log(`\n${total} requests in ${elapsed.toFixed(1)} s = ${rps.toFixed(0)} per second (${errors} errors; statuses ${JSON.stringify(statusCounts)})`);
for (const [kind, list] of Object.entries(latencies)) {
  console.log(`  ${kind.padEnd(10)} ${String(list.length).padStart(6)}  p50 ${pct(list, 50).toFixed(1)} ms  p95 ${pct(list, 95).toFixed(1)} ms  p99 ${pct(list, 99).toFixed(1)} ms`);
}
console.log(`\nAt one check-in per phone every 5 minutes, this process could serve about ${Math.floor(rps * 300).toLocaleString('en')} phones.`);
console.log('(In-memory MongoDB on the same machine: a real deployment adds network time to the database.)');

server.close();
await mongoose.disconnect();
await mongo.stop();
process.exit(0);
