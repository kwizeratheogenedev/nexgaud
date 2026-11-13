import { Router } from 'express';
import { z } from 'zod';
import { Device } from '../models/Device.js';
import { isLostStatus, Location, updateRetention } from '../models/Location.js';
import { Alert } from '../models/Alert.js';
import { Command, COMMAND_TYPES } from '../models/Command.js';
import { hmac, randomToken } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { objectId, validate } from '../lib/validate.js';
import { requireUser } from '../middleware/auth.js';
import { wakeDevice } from '../services/push.js';

// Owner-facing device routes (web dashboard and the app's own account screens).
const router = Router();
router.use(requireUser);

export const MAX_DEVICES_PER_USER = 10;
const MAX_HISTORY_DAYS = 7;

async function ownedDevice(req) {
  const device = await Device.findOne({ _id: req.valid.params.id, ownerId: req.user._id });
  if (!device) throw notFound('Device');
  return device;
}

const idParams = validate(z.object({ id: objectId }), 'params');

// Pairing: the app signs in as the owner, then registers the phone and keeps the device token.
router.post(
  '/',
  validate(
    z.object({
      name: z.string().trim().min(1).max(60),
      type: z.enum(['phone', 'laptop']).default('phone'),
      platform: z.enum(['android', 'ios', 'windows', 'macos', 'linux']).default('android'),
      brand: z.string().max(60).optional(),
      model: z.string().max(80).optional(),
      osVersion: z.string().max(40).optional(),
      appVersion: z.string().max(40).optional(),
      pushToken: z.string().max(4096).optional(),
    }),
  ),
  async (req, res) => {
    const count = await Device.countDocuments({ ownerId: req.user._id });
    if (count >= MAX_DEVICES_PER_USER) {
      throw badRequest('device_limit', `You can add up to ${MAX_DEVICES_PER_USER} devices`);
    }
    const deviceToken = randomToken();
    const device = await Device.create({
      ...req.valid.body,
      ownerId: req.user._id,
      tokenHash: hmac(deviceToken),
      lastSeenAt: new Date(),
    });
    // The token is shown once; only its hash is stored.
    res.status(201).json({ device: device.toPublic(), deviceToken });
  },
);

router.get('/', async (req, res) => {
  const devices = await Device.find({ ownerId: req.user._id }).sort({ createdAt: 1 });
  res.json({ devices: devices.map((d) => d.toPublic()) });
});

router.get('/:id', idParams, async (req, res) => {
  res.json({ device: (await ownedDevice(req)).toPublic() });
});

router.patch(
  '/:id',
  idParams,
  validate(
    z
      .object({
        name: z.string().trim().min(1).max(60).optional(),
        status: z.enum(['normal', 'lost', 'recovered']).optional(),
        // Shown on the phone's screen while it is lost.
        lostMessage: z.string().trim().max(200).optional(),
        contactPhone: z
          .string()
          .trim()
          .regex(/^\+?[0-9 ]{7,20}$/, 'Enter a phone number, digits only')
          .optional()
          .or(z.literal('')),
      })
      .refine((v) => Object.keys(v).length > 0, 'Nothing to change'),
  ),
  async (req, res) => {
    const device = await ownedDevice(req);
    const { name, status, lostMessage, contactPhone } = req.valid.body;
    const wasLost = isLostStatus(device.status);
    if (name) device.name = name;
    if (status) device.status = status;
    const isLost = isLostStatus(device.status);

    if (isLost) {
      if (!wasLost) device.lostMode = { since: new Date() };
      if (lostMessage !== undefined) device.set('lostMode.message', lostMessage || undefined);
      if (contactPhone !== undefined) device.set('lostMode.contactPhone', contactPhone || undefined);
    } else if (wasLost) {
      device.lostMode = undefined;
    }
    await device.save();

    if (wasLost !== isLost) {
      // Lost devices keep their history for a year; found ones go back to 30 days.
      await updateRetention(device);
      // Wake the phone so it switches to lost mode (or back) right away.
      await wakeDevice(device);
    }
    res.json({ device: device.toPublic() });
  },
);

// Removing a device unpairs it: its token stops working and its history is deleted.
router.delete('/:id', idParams, async (req, res) => {
  const device = await ownedDevice(req);
  await Promise.all([
    Location.deleteMany({ deviceId: device._id }),
    Command.deleteMany({ deviceId: device._id }),
    Alert.deleteMany({ deviceId: device._id }),
    device.deleteOne(),
  ]);
  res.status(204).end();
});

router.get(
  '/:id/locations',
  idParams,
  validate(
    z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      limit: z.coerce.number().int().min(1).max(5000).default(2000),
    }),
    'query',
  ),
  async (req, res) => {
    const device = await ownedDevice(req);
    const to = req.valid.query.to ?? new Date();
    const from = req.valid.query.from ?? new Date(to.getTime() - 24 * 3600 * 1000);
    if (from > to) throw badRequest('bad_range', '"from" must be before "to"');
    if (to - from > MAX_HISTORY_DAYS * 86400 * 1000) {
      throw badRequest('range_too_long', `Ask for at most ${MAX_HISTORY_DAYS} days at a time`);
    }
    const points = await Location.find({ deviceId: device._id, recordedAt: { $gte: from, $lte: to } })
      .sort({ recordedAt: 1 })
      .limit(req.valid.query.limit)
      .lean();
    res.json({
      from,
      to,
      points: points.map((p) => ({
        lat: p.point.coordinates[1],
        lng: p.point.coordinates[0],
        accuracyM: p.accuracyM ?? null,
        source: p.source,
        battery: p.battery ?? null,
        at: p.recordedAt,
      })),
    });
  },
);

router.post(
  '/:id/commands',
  idParams,
  validate(
    z.object({
      type: z.enum(COMMAND_TYPES),
      payload: z
        .object({
          message: z.string().trim().max(200).optional(),
          contactPhone: z.string().trim().max(20).optional(),
          durationSec: z.number().int().min(5).max(120).optional(),
        })
        .default({}),
    }),
  ),
  async (req, res) => {
    const device = await ownedDevice(req);
    const { type, payload } = req.valid.body;
    if (type === 'message' && !payload.message) throw badRequest('message_required', 'Write the message to show');

    // A newer command of the same type replaces one still waiting.
    await Command.updateMany(
      { deviceId: device._id, type, status: 'queued' },
      { status: 'expired', result: 'Replaced by a newer command', completedAt: new Date() },
    );
    const command = await Command.create({ deviceId: device._id, type, payload, createdBy: req.user._id });
    command.pushed = await wakeDevice(device);
    if (command.pushed) await command.save();
    res.status(201).json({ command: command.toPublic() });
  },
);

router.get('/:id/commands', idParams, async (req, res) => {
  const device = await ownedDevice(req);
  await expireOld(device._id);
  const commands = await Command.find({ deviceId: device._id }).sort({ createdAt: -1 }).limit(20);
  res.json({ commands: commands.map((c) => c.toPublic()) });
});

export async function expireOld(deviceId) {
  await Command.updateMany(
    { deviceId, status: { $in: ['queued', 'sent'] }, expiresAt: { $lte: new Date() } },
    { status: 'expired', result: 'The phone did not answer in time', completedAt: new Date() },
  );
}

export default router;
