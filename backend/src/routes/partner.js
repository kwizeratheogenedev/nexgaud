import { Router } from 'express';
import { z } from 'zod';
import { MAX_API_KEYS } from '../models/Partner.js';
import { CheckLog } from '../models/CheckLog.js';
import { RegistryItem } from '../models/RegistryItem.js';
import { hmac, randomToken } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { objectId, validate } from '../lib/validate.js';
import { requirePartner } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { runCheck } from '../services/registry.js';

/**
 * Partner portal and API. Shops check phones before buying them; one request can check up to 100.
 *   POST /partner/check  { "items": ["356938035643809", ...] }  with  Authorization: ApiKey ngk_...
 */
const router = Router();
router.use(requirePartner);

export const MAX_BULK = 100;

const portalOnly = (req, _res, next) =>
  req.partnerAuth === 'portal' ? next() : next(forbidden('Sign in to the partner portal to manage keys'));

router.get('/me', (req, res) => {
  res.json({ partner: req.partner.toPublic(), auth: req.partnerAuth });
});

async function checkAll(req, inputs) {
  const source = req.partnerAuth === 'api_key' ? 'partner_api' : 'partner_portal';
  const results = [];
  // One at a time: a bulk check is at most 100 small queries, and order matters for the reply.
  for (const input of inputs) {
    results.push({ input, ...(await runCheck(input, { source, partner: req.partner, user: req.user })) });
  }
  return results;
}

router.get('/check', validate(z.object({ q: z.string().trim().min(1).max(40) }), 'query'), async (req, res) => {
  const [result] = await checkAll(req, [req.valid.query.q]);
  res.json(result);
});

router.post(
  '/check',
  validate(z.object({ items: z.array(z.string().trim().min(1).max(40)).min(1).max(MAX_BULK) })),
  async (req, res) => {
    const results = await checkAll(req, req.valid.body.items);
    const flagged = results.filter((r) => ['stolen', 'lost'].includes(r.result)).length;
    res.json({ results, summary: { checked: results.length, flagged } });
  },
);

// The partner's recent checks (results only: the IMEIs typed are not stored).
router.get(
  '/checks',
  validate(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), 'query'),
  async (req, res) => {
    const checks = await CheckLog.find({ partnerId: req.partner._id }).sort({ createdAt: -1 }).limit(req.valid.query.limit).lean();
    const items = await RegistryItem.find({ _id: { $in: checks.map((c) => c.itemId).filter(Boolean) } }).select('brand model');
    const weekAgo = new Date(Date.now() - 7 * 86400 * 1000);
    const [week, flaggedWeek] = await Promise.all([
      CheckLog.countDocuments({ partnerId: req.partner._id, createdAt: { $gte: weekAgo } }),
      CheckLog.countDocuments({ partnerId: req.partner._id, createdAt: { $gte: weekAgo }, result: { $in: ['stolen', 'lost'] } }),
    ]);
    res.json({
      week: { checked: week, flagged: flaggedWeek },
      checks: checks.map((c) => ({
        id: String(c._id),
        source: c.source,
        result: c.result,
        device: c.itemId ? (items.find((i) => i.id === String(c.itemId))?.label() ?? null) : null,
        createdAt: c.createdAt,
      })),
    });
  },
);

// API keys, made by members in the portal. The key is shown once; only its HMAC is stored.
router.post('/keys', portalOnly, validate(z.object({ name: z.string().trim().min(1).max(40) })), async (req, res) => {
  const active = req.partner.apiKeys.filter((k) => !k.revokedAt);
  if (active.length >= MAX_API_KEYS) throw badRequest('key_limit', `A partner can have up to ${MAX_API_KEYS} keys`);
  const key = `ngk_${randomToken(30)}`;
  req.partner.apiKeys.push({ name: req.valid.body.name, prefix: key.slice(0, 10), hash: hmac(key), createdBy: req.user._id });
  await req.partner.save();
  const created = req.partner.apiKeys.at(-1);
  await audit(req, 'partner.key_created', req.partner, { keyId: created.id, name: created.name });
  res.status(201).json({ key, apiKey: req.partner.toPublic().apiKeys.find((k) => k.id === created.id) });
});

router.delete('/keys/:keyId', portalOnly, validate(z.object({ keyId: objectId }), 'params'), async (req, res) => {
  const apiKey = req.partner.apiKeys.id(req.valid.params.keyId);
  if (!apiKey || apiKey.revokedAt) throw notFound('API key');
  apiKey.revokedAt = new Date();
  await req.partner.save();
  await audit(req, 'partner.key_revoked', req.partner, { keyId: apiKey.id, name: apiKey.name });
  res.status(204).end();
});

export default router;
