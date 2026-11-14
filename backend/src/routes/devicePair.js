import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { Device } from '../models/Device.js';
import { Org } from '../models/Org.js';
import { PairingCode } from '../models/PairingCode.js';
import { hmac, randomToken } from '../lib/crypto.js';
import { badRequest, tooMany } from '../lib/errors.js';
import { normalizeCode } from '../lib/codes.js';
import { validate } from '../lib/validate.js';
import { audit } from '../services/audit.js';
import { checkOrgSeats } from './devices.js';

/**
 * POST /device/pair: the laptop agent swaps a one-time pairing code for its device token.
 * No sign-in (the agent has none); the code is the proof, so tries are limited per IP.
 */
const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: (_req, _res, next) => next(tooMany()),
});

router.post(
  '/',
  limiter,
  validate(
    z.object({
      code: z.string().trim().min(8).max(12),
      name: z.string().trim().min(1).max(60).optional(),
      platform: z.enum(['windows', 'macos', 'linux']),
      osVersion: z.string().max(40).optional(),
      appVersion: z.string().max(40).optional(),
      hostname: z.string().trim().max(80).optional(),
      brand: z.string().max(60).optional(),
      model: z.string().max(80).optional(),
    }),
  ),
  async (req, res) => {
    const { code, name, hostname, ...info } = req.valid.body;
    // Used at most once, even if two agents send the same code at the same moment.
    const pairing = await PairingCode.findOneAndUpdate(
      { codeHash: hmac(`pair:${normalizeCode(code)}`), usedAt: null, expiresAt: { $gt: new Date() } },
      { usedAt: new Date() },
      { new: true },
    );
    if (!pairing) throw badRequest('pairing_invalid', 'This code is wrong, used or expired. Make a new one in the dashboard.');

    const org = pairing.orgId ? await Org.findById(pairing.orgId) : null;
    if (pairing.orgId && org?.status !== 'active') throw badRequest('pairing_invalid', 'This organisation is not active');
    // Several codes may have been made before the seats ran out.
    if (pairing.orgId) await checkOrgSeats(pairing.orgId);

    const deviceToken = randomToken();
    const device = await Device.create({
      ...info,
      type: 'laptop',
      name: pairing.name ?? name ?? hostname ?? 'Laptop',
      hostname,
      ownerId: pairing.ownerId,
      orgId: pairing.orgId,
      assignedTo: pairing.assignedTo,
      tokenHash: hmac(deviceToken),
      lastSeenAt: new Date(),
    });
    pairing.deviceId = device._id;
    await pairing.save();
    await audit({ user: { _id: pairing.ownerId, role: 'agent' } }, 'device.paired', device, { platform: device.platform, orgId: pairing.orgId ? String(pairing.orgId) : null });
    // The agent shows who manages it, so nobody's laptop is tracked without them knowing.
    res.status(201).json({ deviceToken, device: device.toPublic(), org: org ? { name: org.name } : null });
  },
);

export default router;
