/**
 * Demo mode for development: no MongoDB install and no phone needed.
 *   npm run demo
 * - Starts an in-memory MongoDB (wiped when you stop it).
 * - Starts the API.
 * - Creates an owner (DEMO_PHONE, default 0788000001) with one simulated phone that
 *   walks around central Kigali, uploads its location every 15 seconds and answers commands.
 * Sign in to the dashboard with that number; the code is printed in this terminal.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Reuse the MongoDB binary the tests already downloaded (about 780 MB) instead of fetching another copy.
const cacheDir = fileURLToPath(new URL('../node_modules/.cache/mongodb-memory-server/', import.meta.url));
const cached = existsSync(cacheDir) && readdirSync(cacheDir).find((f) => /^mongod-.*?(\.exe)?$/.test(f) && !f.endsWith('.md5'));
if (cached && !process.env.MONGOMS_SYSTEM_BINARY) process.env.MONGOMS_SYSTEM_BINARY = join(cacheDir, cached);

if (process.env.NODE_ENV === 'production') {
  console.error('Demo mode must not run in production.');
  process.exit(1);
}

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('nexguard');

const { config } = await import('../src/config.js');
const { logger } = await import('../src/logger.js');
await import('../src/server.js');
const mongoose = (await import('mongoose')).default;
const { User } = await import('../src/models/User.js');
const { Device } = await import('../src/models/Device.js');
const { hmac, randomToken } = await import('../src/lib/crypto.js');
const { normalizePhone } = await import('../src/lib/phone.js');

await mongoose.connection.asPromise();

const phone = normalizePhone(process.env.DEMO_PHONE ?? '0788000001');
const owner = await User.create({ phone, name: 'Demo Owner' });
// A NexGuard team member who can open the pilot statistics.
const adminPhone = normalizePhone(process.env.DEMO_ADMIN_PHONE ?? '0788000009');
await User.create({ phone: adminPhone, name: 'NexGuard Team', role: 'admin' });
const deviceToken = randomToken();
await Device.create({
  ownerId: owner._id,
  name: 'Demo Tecno Spark',
  brand: 'TECNO',
  model: 'Spark 20 (simulated)',
  osVersion: '14',
  appVersion: '0.1.0-demo',
  tokenHash: hmac(deviceToken),
  permissions: { location: 'always', notifications: true, batteryOptimized: false, deviceAdmin: true },
});

// A loop through central Kigali: city centre → Nyabugogo road → Kimihurura → back.
const PATH = [
  [-1.9441, 30.0619], [-1.9468, 30.0587], [-1.9496, 30.0551], [-1.9530, 30.0602],
  [-1.9555, 30.0680], [-1.9531, 30.0759], [-1.9502, 30.0824], [-1.9466, 30.0874],
  [-1.9422, 30.0838], [-1.9405, 30.0754], [-1.9421, 30.0677],
];
const STEPS_PER_LEG = 4;
const base = `http://localhost:${config.PORT}/api/v1/device`;
const headers = { Authorization: `Device ${deviceToken}`, 'Content-Type': 'application/json' };
let step = 0;
let battery = 87;

function positionAt(i) {
  const leg = Math.floor(i / STEPS_PER_LEG) % PATH.length;
  const t = (i % STEPS_PER_LEG) / STEPS_PER_LEG;
  const [a, b] = [PATH[leg], PATH[(leg + 1) % PATH.length]];
  return { lat: a[0] + (b[0] - a[0]) * t, lng: a[1] + (b[1] - a[1]) * t };
}

async function answer(command) {
  const results = {
    ring: 'Rang for 30 seconds (simulated)',
    locate: 'Sent a fresh location (simulated)',
    lock: 'Screen locked (simulated)',
    message: `Showed "${command.payload?.message ?? ''}" (simulated)`,
  };
  await fetch(`${base}/commands/${command.id}/ack`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ status: 'done', result: results[command.type] }),
  });
  logger.info(`[demo phone] handled "${command.type}"`);
}

async function tick() {
  try {
    const points = [];
    // On the first tick, back-fill the last hour so the dashboard has a route to draw.
    const count = step === 0 ? 40 : 1;
    for (let k = count - 1; k >= 0; k--) {
      const p = positionAt(step);
      points.push({
        ...p,
        accuracyM: 8 + Math.round(Math.random() * 20),
        source: 'gps',
        battery,
        recordedAt: new Date(Date.now() - k * 90 * 1000).toISOString(),
      });
      step++;
    }
    battery = Math.max(5, battery - 0.2);
    const res = await fetch(`${base}/locations`, { method: 'POST', headers, body: JSON.stringify({ points: points.map((p) => ({ ...p, battery: Math.round(p.battery) })) }) });
    const body = await res.json();
    for (const c of body.commands ?? []) await answer(c);
  } catch (err) {
    logger.warn({ err: err.message }, '[demo phone] upload failed');
  }
}

async function heartbeat(simFingerprint) {
  const res = await fetch(`${base}/heartbeat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ battery: Math.round(battery), charging: false, network: 'cellular', simFingerprint }),
  });
  return res.json();
}

await tick();
// A SIM swap a minute after start, so the dashboard has an alert to show.
await heartbeat('demo-sim-mtn');
setTimeout(() => heartbeat('demo-sim-other').then(() => logger.info('[demo phone] SIM card changed')), 60000);
setInterval(tick, 15000);

logger.info(`Demo ready. Sign in to the dashboard with ${phone}, or ${adminPhone} for the pilot statistics (codes appear below as [dev SMS]).`);

const stop = async () => {
  await mongo.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
