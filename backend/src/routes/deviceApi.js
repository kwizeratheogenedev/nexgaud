import { Router } from 'express';
import { z } from 'zod';
import { Location, locationExpiry } from '../models/Location.js';
import { Command } from '../models/Command.js';
import { PHONE_EVENT_TYPES } from '../models/Alert.js';
import { raiseAlert } from '../services/alerts.js';
import { notFound } from '../lib/errors.js';
import { objectId, validate } from '../lib/validate.js';
import { requireDevice } from '../middleware/auth.js';
import { expireOld } from './devices.js';
import { Org } from '../models/Org.js';
import { publishLocations, publishState } from '../services/liveFeed.js';

// Routes the phone itself calls, authenticated with its device token.
const router = Router();
router.use(requireDevice);

const MAX_POINTS_PER_UPLOAD = 500;
// Points stamped far in the future (wrong phone clock) are rejected.
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

async function takePendingCommands(device) {
  await expireOld(device._id);
  const pending = await Command.find({ deviceId: device._id, status: { $in: ['queued', 'sent'] } }).sort({
    createdAt: 1,
  });
  const now = new Date();
  const queuedIds = pending.filter((c) => c.status === 'queued').map((c) => c._id);
  if (queuedIds.length) {
    await Command.updateMany({ _id: { $in: queuedIds } }, { status: 'sent', sentAt: now });
  }
  return pending.map((c) => ({ ...c.toPublic(), status: 'sent' }));
}

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100000).optional(),
  source: z.enum(['gps', 'network', 'fused', 'wifi', 'unknown']).default('unknown'),
  battery: z.number().int().min(0).max(100).optional(),
  recordedAt: z.coerce.date(),
});

/** Stores points and moves the last known location forward. Returns how many were accepted. */
async function storePoints(device, incoming) {
  const now = Date.now();
  const points = incoming.filter((p) => p.recordedAt.getTime() <= now + MAX_CLOCK_SKEW_MS);
  if (!points.length) return 0;

  const expiresAt = locationExpiry(device, now);
  await Location.insertMany(
    points.map((p) => ({
      deviceId: device._id,
      point: { type: 'Point', coordinates: [p.lng, p.lat] },
      accuracyM: p.accuracyM,
      source: p.source,
      battery: p.battery,
      recordedAt: p.recordedAt,
      receivedAt: new Date(now),
      expiresAt,
    })),
    { ordered: false },
  );
  publishLocations(device, points);
  const latest = points.reduce((a, b) => (b.recordedAt > a.recordedAt ? b : a));
  if (!device.lastLocationAt || latest.recordedAt > device.lastLocationAt) {
    device.lastLocation = { type: 'Point', coordinates: [latest.lng, latest.lat] };
    device.lastLocationAt = latest.recordedAt;
    device.lastAccuracyM = latest.accuracyM;
    if (latest.battery != null) device.battery = latest.battery;
  }
  return points.length;
}

/** What every reply to the phone carries: its status, the lost-mode screen, and waiting commands. */
async function phoneState(device) {
  return {
    status: device.status,
    lostMode: device.lostModePublic(),
    // Live tracking: send the position every few seconds until then (null = normal rate).
    liveUntil: device.liveUntil && device.liveUntil > new Date() ? device.liveUntil.toISOString() : null,
    commands: await takePendingCommands(device),
  };
}

// The phone uploads queued points in batches; the reply carries any commands waiting for it.
router.post(
  '/locations',
  validate(z.object({ points: z.array(pointSchema).min(1).max(MAX_POINTS_PER_UPLOAD) })),
  async (req, res) => {
    const device = req.device;
    const accepted = await storePoints(device, req.valid.body.points);
    device.lastSeenAt = new Date();
    await device.save();
    publishState(device);

    res.json({
      accepted,
      rejected: req.valid.body.points.length - accepted,
      ...(await phoneState(device)),
    });
  },
);

// Something happened on the phone that the owner should hear about (low battery, protection
// turned off, wrong PIN, switching off). The phone sends its last location with it when it can.
router.post(
  '/events',
  validate(
    z.object({
      type: z.enum(PHONE_EVENT_TYPES),
      battery: z.number().int().min(0).max(100).optional(),
      location: pointSchema.optional(),
    }),
  ),
  async (req, res) => {
    const device = req.device;
    const { type, battery, location } = req.valid.body;
    if (location) await storePoints(device, [location]);
    if (battery != null) device.battery = battery;
    device.lastSeenAt = new Date();
    await device.save();

    const alert = await raiseAlert(device, type, {
      battery,
      location: location && {
        lat: location.lat,
        lng: location.lng,
        accuracyM: location.accuracyM,
        at: location.recordedAt,
      },
    });
    res.status(201).json({ alert: alert.toPublic(), ...(await phoneState(device)) });
  },
);

// The SIM fingerprint is a hash of the SIM's network and subscription; "no-sim" when none is inserted.
const NO_SIM = 'no-sim';

async function checkSim(device, fingerprint) {
  const previous = device.simFingerprint;
  if (fingerprint === undefined || fingerprint === previous) return;
  device.simFingerprint = fingerprint;
  // The first report only sets the baseline.
  if (!previous) return;

  const type = fingerprint === NO_SIM ? 'sim_removed' : 'sim_changed';
  device.simChangedAt = new Date();
  const loc = device.lastLocation?.coordinates;
  await raiseAlert(device, type, {
    battery: device.battery,
    location: loc && { lat: loc[1], lng: loc[0], accuracyM: device.lastAccuracyM, at: device.lastLocationAt },
  });
}

router.post(
  '/heartbeat',
  validate(
    z.object({
      battery: z.number().int().min(0).max(100).optional(),
      charging: z.boolean().optional(),
      network: z.enum(['wifi', 'cellular', 'none', 'other']).optional(),
      simFingerprint: z.string().max(128).optional(),
      pushToken: z.string().max(4096).optional(),
      appVersion: z.string().max(40).optional(),
      osVersion: z.string().max(40).optional(),
      permissions: z
        .object({
          location: z.enum(['always', 'while_in_use', 'denied']).optional(),
          notifications: z.boolean().optional(),
          batteryOptimized: z.boolean().optional(),
          deviceAdmin: z.boolean().optional(),
        })
        .optional(),
    }),
  ),
  async (req, res) => {
    const device = req.device;
    const { permissions, simFingerprint, ...rest } = req.valid.body;
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) device[key] = value;
    }
    for (const [key, value] of Object.entries(permissions ?? {})) {
      device.set(`permissions.${key}`, value);
    }
    await checkSim(device, simFingerprint);
    device.lastSeenAt = new Date();
    await device.save();
    publishState(device);
    res.json(await phoneState(device));
  },
);

router.get('/commands', async (req, res) => {
  res.json(await phoneState(req.device));
});

router.post(
  '/commands/:id/ack',
  validate(z.object({ id: objectId }), 'params'),
  validate(z.object({ status: z.enum(['done', 'failed']), result: z.string().max(300).optional() })),
  async (req, res) => {
    const command = await Command.findOne({ _id: req.valid.params.id, deviceId: req.device._id });
    if (!command) throw notFound('Command');
    if (['queued', 'sent'].includes(command.status)) {
      command.status = req.valid.body.status;
      command.result = req.valid.body.result;
      command.completedAt = new Date();
      await command.save();
    }
    res.json({ command: command.toPublic() });
  },
);

// What the app shows on its own screen: which account protects it and whether it is marked lost.
// Laptops also show who manages them (an organisation), so tracking is never hidden.
router.get('/me', async (req, res) => {
  const org = req.device.orgId ? await Org.findById(req.device.orgId).select('name') : null;
  res.json({ device: req.device.toPublic(), org: org ? { name: org.name } : null });
});

export default router;
