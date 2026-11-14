import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { badRequest, notFound, tooMany } from '../lib/errors.js';
import { classifyQuery, IMEI_ERRORS } from '../lib/imei.js';
import { normalizePhone } from '../lib/phone.js';
import { validate } from '../lib/validate.js';
import { findItems, notifyOwner, openReportFor, runCheck } from '../services/registry.js';

// Public, no sign-in: anyone can check a phone before buying it, and tell the owner they have seen it.
const router = Router();

const limiter = (limit, windowMs) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => config.isTest,
    handler: (_req, _res, next) => next(tooMany()),
  });

// Enough for a buyer comparing a few phones; too few to scan the registry.
const checkLimiter = limiter(30, 15 * 60 * 1000);
const tipLimiter = limiter(5, 60 * 60 * 1000);

router.get(
  '/',
  checkLimiter,
  validate(z.object({ q: z.string().trim().min(1).max(40) }), 'query'),
  async (req, res) => {
    res.json(await runCheck(req.valid.query.q, { source: 'web', requester: req.ip }));
  },
);

// "I have seen this phone": goes to the owner of a reported device as an alert and SMS.
router.post(
  '/tip',
  tipLimiter,
  validate(
    z.object({
      q: z.string().trim().min(1).max(40),
      message: z.string().trim().min(5).max(500),
      contactPhone: z.string().trim().max(20).optional(),
    }),
  ),
  async (req, res) => {
    const { q, message } = req.valid.body;
    const contactPhone = req.valid.body.contactPhone ? normalizePhone(req.valid.body.contactPhone) : null;
    if (req.valid.body.contactPhone && !contactPhone) throw badRequest('contact_invalid', 'Enter a valid phone number');
    const parsed = classifyQuery(q);
    if (parsed.kind === 'invalid') throw badRequest('invalid_identifier', IMEI_ERRORS[parsed.reason]);
    const [item] = (await findItems(parsed)).filter((i) => i.status !== 'registered');
    if (!item || !(await openReportFor(item._id))) throw notFound('Reported device');
    await notifyOwner(item, 'registry_tip', { source: 'web', message, contactPhone: contactPhone ?? undefined, smsCooldownMs: 3600 * 1000 });
    res.status(201).json({ sent: true });
  },
);

export default router;
