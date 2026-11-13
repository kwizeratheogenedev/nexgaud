import { Router } from 'express';
import { z } from 'zod';
import { Location } from '../models/Location.js';
import { Command } from '../models/Command.js';
import { notFound } from '../lib/errors.js';
import { objectId, validate } from '../lib/validate.js';
import { requireDevice } from '../middleware/auth.js';
import { expireOld } from './devices.js';

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

// The phone uploads queued points in batches; the reply carries any commands waiting for it.
router.post(
  '/locations',
  validate(z.object({ points: z.array(pointSchema).min(1).max(MAX_POINTS_PER_UPLOAD) })),
  async (req, res) => {
    const device = req.device;
    const now = Date.now();
    const points = req.valid.body.points.filter((p) => p.recordedAt.getTime() <= now + MAX_CLOCK_SKEW_MS);

    if (points.length) {
      await Location.insertMany(
        points.map((p) => ({
          deviceId: device._id,
          point: { type: 'Point', coordinates: [p.lng, p.lat] },
          accuracyM: p.accuracyM,
          source: p.source,
          battery: p.battery,
          recordedAt: p.recordedAt,
        })),
        { ordered: false },
      );
      const latest = points.reduce((a, b) => (b.recordedAt > a.recordedAt ? b : a));
      if (!device.lastLocationAt || latest.recordedAt > device.lastLocationAt) {
        device.lastLocation = { type: 'Point', coordinates: [latest.lng, latest.lat] };
        device.lastLocationAt = latest.recordedAt;
        device.lastAccuracyM = latest.accuracyM;
        if (latest.battery != null) device.battery = latest.battery;
      }
    }
    device.lastSeenAt = new Date(now);
    await device.save();

    res.json({
      accepted: points.length,
      rejected: req.valid.body.points.length - points.length,
      commands: await takePendingCommands(device),
    });
  },
);

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
    const { permissions, ...rest } = req.valid.body;
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) device[key] = value;
    }
    for (const [key, value] of Object.entries(permissions ?? {})) {
      device.set(`permissions.${key}`, value);
    }
    device.lastSeenAt = new Date();
    await device.save();
    res.json({ status: device.status, commands: await takePendingCommands(device) });
  },
);

router.get('/commands', async (req, res) => {
  res.json({ commands: await takePendingCommands(req.device) });
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
router.get('/me', async (req, res) => {
  res.json({ device: req.device.toPublic() });
});

export default router;
