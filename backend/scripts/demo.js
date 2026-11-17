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

// Demo mode: the sign-in page shows each code, because no real SMS is sent.
process.env.NEXGUARD_DEMO = '1';

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
const demoDevice = await Device.create({
  ownerId: owner._id,
  name: 'Demo Tecno Spark',
  brand: 'TECNO',
  model: 'Spark 20 (simulated)',
  osVersion: '14',
  appVersion: '0.1.0-demo',
  tokenHash: hmac(deviceToken),
  permissions: { location: 'always', notifications: true, batteryOptimized: false, deviceAdmin: true },
});

// Stolen-device registry: a partner shop, registered phones, a report to review and a dispute.
const { RegistryItem } = await import('../src/models/RegistryItem.js');
const { TheftReport } = await import('../src/models/TheftReport.js');
const { Dispute } = await import('../src/models/Dispute.js');
const { Partner } = await import('../src/models/Partner.js');
const { luhnValid } = await import('../src/lib/imei.js');
const imei = (base14) => base14 + [...'0123456789'].find((d) => luhnValid(base14 + d));
const DEMO_IMEIS = { tracked: imei('35693803564380'), stolen: imei('86754203112233'), pending: imei('35281209876543') };

const shop = await Partner.create({ name: 'Kigali Phones (demo)', type: 'shop', district: 'Nyarugenge' });
const shopPhone = normalizePhone('0788000005');
await User.create({ phone: shopPhone, name: 'Shop Clerk', role: 'shop', partnerId: shop._id });
const neighbour = await User.create({ phone: normalizePhone('0788000002'), name: 'Demo Neighbour' });
const admin = await User.findOne({ phone: adminPhone });

await RegistryItem.create({ ownerId: owner._id, brand: 'TECNO', model: 'Spark 20', imeis: [DEMO_IMEIS.tracked], deviceId: demoDevice._id });
const stolenItem = await RegistryItem.create({ ownerId: owner._id, brand: 'Samsung', model: 'Galaxy A15', color: 'Black', imeis: [DEMO_IMEIS.stolen], status: 'stolen' });
await TheftReport.create({
  itemId: stolenItem._id, ownerId: owner._id, type: 'stolen', incidentAt: new Date(Date.now() - 3 * 86400000),
  place: 'Nyabugogo bus park', policeCaseNumber: 'RIB/2026/0042', policeStation: 'Nyarugenge', status: 'approved',
  reviewedBy: admin._id, reviewedAt: new Date(Date.now() - 2 * 86400000),
});
const pendingItem = await RegistryItem.create({ ownerId: neighbour._id, brand: 'Infinix', model: 'Hot 40', imeis: [DEMO_IMEIS.pending] });
await TheftReport.create({
  itemId: pendingItem._id, ownerId: neighbour._id, type: 'stolen', incidentAt: new Date(Date.now() - 86400000),
  place: 'Kimironko market', description: 'Taken from my bag while shopping.', policeCaseNumber: 'RIB/2026/0107', policeStation: 'Remera',
});
await Dispute.create({ itemId: stolenItem._id, raisedBy: neighbour._id, reason: 'report', message: 'I bought this phone second-hand last month and now it shows as stolen.' });

// QR tags and an organisation: the owner manages a demo school, has a tag with a finder's message,
// and the team has printed a batch of tags to sell.
const { Org } = await import('../src/models/Org.js');
const { Tag } = await import('../src/models/Tag.js');
const { TagBatch } = await import('../src/models/TagBatch.js');
const { TagThread } = await import('../src/models/TagThread.js');
const { randomCode } = await import('../src/lib/codes.js');
const school = await Org.create({ name: 'Green Hills Academy (demo)', type: 'school', district: 'Gasabo', createdBy: owner._id, members: [{ userId: owner._id }, { userId: neighbour._id }] });
const keys = await Tag.create({ code: randomCode(8), status: 'active', ownerId: owner._id, name: 'House keys', kind: 'keys', message: 'Thank you for finding my keys! Please write to me.', claimedAt: new Date(), scans: 1, lastScanAt: new Date(Date.now() - 3600000) });
await Tag.create({ code: randomCode(8), status: 'active', ownerId: owner._id, orgId: school._id, name: 'Projector bag', kind: 'bag', message: 'Please bring this to the Green Hills Academy reception.', claimedAt: new Date() });
await TagThread.create({
  tagId: keys._id, ownerId: owner._id, finderTokenHash: hmac(`thread:${randomToken(24)}`), finderPhone: normalizePhone('0788555444'), finderLanguage: 'rw',
  messages: [{ from: 'finder', text: 'I found your keys at Kimironko market, near the fruit stalls.', location: { lat: -1.9502, lng: 30.1255, accuracyM: 20 } }],
});
const batch = await TagBatch.create({ name: 'Kigali Phones, demo pack', count: 6, createdBy: admin._id });
await Tag.insertMany(Array.from({ length: 6 }, () => ({ code: randomCode(8), claimCode: randomCode(6), batchId: batch._id, status: 'unclaimed' })));

// Family sharing: the owner's family includes the neighbour, who shares a phone. It shows up for the
// owner once they buy the Family plan (use "Test payment" on the Plans & billing page).
const { Family } = await import('../src/models/Family.js');
await Family.create({ ownerId: owner._id, name: 'Demo family', members: [{ userId: neighbour._id }] });
await Device.create({
  ownerId: neighbour._id, name: 'Neighbour phone', brand: 'itel', model: 'A70', osVersion: '13', familyShared: true,
  tokenHash: hmac(randomToken()), lastSeenAt: new Date(), battery: 64,
  lastLocation: { type: 'Point', coordinates: [30.1044, -1.9536] }, lastLocationAt: new Date(), lastAccuracyM: 25,
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

logger.info(`Demo ready. Sign in to the dashboard with ${phone}, ${adminPhone} (NexGuard team) or ${shopPhone} (partner shop). Codes appear below as [dev SMS].`);
logger.info(`Tags: the finder page of the "House keys" tag is http://localhost:5173/t/${keys.code}. ${owner.name} also manages "${school.name}"; add a laptop there with the agent in agent/.`);
logger.info('Plans: buy the Family plan with "Test payment" on Plans & billing to see the phone the neighbour shares. A number ending in 13 is declined, 99 never answers.');
logger.info(`Registry: IMEI ${DEMO_IMEIS.stolen} is reported stolen, ${DEMO_IMEIS.tracked} is registered, ${DEMO_IMEIS.pending} has a report waiting for review. Public check: http://localhost:5173/check`);

const stop = async () => {
  await mongo.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
