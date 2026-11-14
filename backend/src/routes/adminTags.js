import { Router } from 'express';
import { z } from 'zod';
import { Tag } from '../models/Tag.js';
import { TagBatch, MAX_BATCH_SIZE } from '../models/TagBatch.js';
import { TagThread } from '../models/TagThread.js';
import { Device } from '../models/Device.js';
import { Org } from '../models/Org.js';
import { Partner } from '../models/Partner.js';
import { notFound } from '../lib/errors.js';
import { randomCode } from '../lib/codes.js';
import { objectId, validate } from '../lib/validate.js';
import { requireRole, requireUser } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { newTagCode, tagUrl } from '../services/tags.js';

/** The NexGuard team: printed tag batches, organisations, and the Phase 4 gate. Mounted under /admin. */
const router = Router();
router.use(requireUser, requireRole('admin'));

export const TAGS_GATE_TARGET = 100;
export const LAPTOP_PLATFORMS = ['windows', 'macos', 'linux'];
const DAY_MS = 86400 * 1000;
const idParams = validate(z.object({ id: objectId }), 'params');

router.get('/phase4/stats', async (_req, res) => {
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const [tagStatuses, laptops, orgs, scans7d, threads7d, batches] = await Promise.all([
    Tag.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Device.aggregate([
      { $match: { type: 'laptop' } },
      {
        $group: {
          _id: '$platform',
          devices: { $sum: 1 },
          seen7d: { $sum: { $cond: [{ $gte: ['$lastSeenAt', weekAgo] }, 1, 0] } },
          inOrgs: { $sum: { $cond: [{ $ifNull: ['$orgId', false] }, 1, 0] } },
        },
      },
    ]),
    Org.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
    Tag.countDocuments({ lastScanAt: { $gte: weekAgo } }),
    TagThread.countDocuments({ createdAt: { $gte: weekAgo } }),
    TagBatch.countDocuments(),
  ]);
  const statuses = Object.fromEntries(tagStatuses.map((t) => [t._id, t.count]));
  const tagsInUse = (statuses.active ?? 0) + (statuses.lost ?? 0);
  const byPlatform = Object.fromEntries(
    LAPTOP_PLATFORMS.map((p) => {
      const row = laptops.find((l) => l._id === p) ?? {};
      return [p, { devices: row.devices ?? 0, seen7d: row.seen7d ?? 0, inOrgs: row.inOrgs ?? 0 }];
    }),
  );
  const platformsRunning = LAPTOP_PLATFORMS.filter((p) => byPlatform[p].seen7d > 0).length;
  res.json({
    generatedAt: new Date(),
    gate: {
      tagsInUse,
      tagsTarget: TAGS_GATE_TARGET,
      platformsRunning,
      platformsTarget: LAPTOP_PLATFORMS.length,
      passed: tagsInUse >= TAGS_GATE_TARGET && platformsRunning === LAPTOP_PLATFORMS.length,
    },
    tags: { statuses, scans7d, threads7d, batches },
    laptops: byPlatform,
    orgs: Object.fromEntries(orgs.map((o) => [o._id, o.count])),
  });
});

// ---- Printed tag batches ----

router.get('/tag-batches', async (_req, res) => {
  const batches = await TagBatch.find().sort({ createdAt: -1 }).limit(100);
  const claimed = await Tag.aggregate([
    { $match: { batchId: { $in: batches.map((b) => b._id) }, status: { $ne: 'unclaimed' } } },
    { $group: { _id: '$batchId', count: { $sum: 1 } } },
  ]);
  const partners = await Partner.find({ _id: { $in: batches.map((b) => b.partnerId).filter(Boolean) } }).select('name');
  res.json({
    batches: batches.map((b) => ({
      id: b.id,
      name: b.name,
      count: b.count,
      claimed: claimed.find((c) => String(c._id) === b.id)?.count ?? 0,
      partner: b.partnerId ? (partners.find((p) => p.id === String(b.partnerId))?.name ?? null) : null,
      createdAt: b.createdAt,
    })),
  });
});

router.post(
  '/tag-batches',
  validate(z.object({ name: z.string().trim().min(2).max(80), count: z.number().int().min(1).max(MAX_BATCH_SIZE), partnerId: objectId.optional() })),
  async (req, res) => {
    const { name, count, partnerId } = req.valid.body;
    if (partnerId && !(await Partner.exists({ _id: partnerId }))) throw notFound('Partner');
    const batch = await TagBatch.create({ name, count, partnerId, createdBy: req.user._id });
    const docs = [];
    for (let i = 0; i < count; i++) docs.push({ code: await newTagCode(), claimCode: randomCode(6), batchId: batch._id, status: 'unclaimed' });
    await Tag.insertMany(docs);
    await audit(req, 'tag_batch.created', batch, { name, count });
    res.status(201).json({ batch: { id: batch.id, name, count, claimed: 0, createdAt: batch.createdAt } });
  },
);

// For printing: each tag's link and, while unclaimed, its claim code. Logged, since claim codes activate tags.
router.get('/tag-batches/:id/tags', idParams, async (req, res) => {
  const batch = await TagBatch.findById(req.valid.params.id);
  if (!batch) throw notFound('Batch');
  const tags = await Tag.find({ batchId: batch._id }).sort({ _id: 1 });
  await audit(req, 'tag_batch.printed', batch);
  res.json({
    batch: { id: batch.id, name: batch.name, count: batch.count },
    tags: tags.map((t) => ({ code: t.code, url: tagUrl(t.code), status: t.status, claimCode: t.status === 'unclaimed' ? t.claimCode : null })),
  });
});

// ---- Organisations ----

router.get('/orgs', async (_req, res) => {
  const orgs = await Org.find().sort({ createdAt: -1 }).limit(200);
  const [devices, tags] = await Promise.all([
    Device.aggregate([{ $match: { orgId: { $ne: null } } }, { $group: { _id: '$orgId', count: { $sum: 1 } } }]),
    Tag.aggregate([{ $match: { orgId: { $ne: null }, status: { $ne: 'disabled' } } }, { $group: { _id: '$orgId', count: { $sum: 1 } } }]),
  ]);
  res.json({
    orgs: orgs.map((o) => ({
      ...o.toPublic(),
      members: o.members.length,
      devices: devices.find((d) => String(d._id) === o.id)?.count ?? 0,
      tags: tags.find((t) => String(t._id) === o.id)?.count ?? 0,
    })),
  });
});

router.patch('/orgs/:id', idParams, validate(z.object({ status: z.enum(['active', 'suspended']) })), async (req, res) => {
  const org = await Org.findById(req.valid.params.id);
  if (!org) throw notFound('Organisation');
  org.status = req.valid.body.status;
  await org.save();
  await audit(req, `org.${org.status === 'active' ? 'reactivated' : 'suspended'}`, org);
  res.json({ org: org.toPublic() });
});

export default router;
