import { Router } from 'express';
import { z } from 'zod';
import { RegistryItem } from '../models/RegistryItem.js';
import { TheftReport, REPORT_STATUSES } from '../models/TheftReport.js';
import { Dispute, DISPUTE_ACTIONS, DISPUTE_STATUSES } from '../models/Dispute.js';
import { Partner, PARTNER_TYPES } from '../models/Partner.js';
import { CheckLog } from '../models/CheckLog.js';
import { AuditLog } from '../models/AuditLog.js';
import { Upload } from '../models/Upload.js';
import { User } from '../models/User.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { classifyQuery } from '../lib/imei.js';
import { normalizePhone } from '../lib/phone.js';
import { objectId, validate } from '../lib/validate.js';
import { sendUpload } from '../lib/upload.js';
import { requireRole, requireUser } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { notifyOwner, openReportFor } from '../services/registry.js';

/**
 * The NexGuard team's registry tools: review stolen reports, settle disputes, manage partners,
 * read the statistics and the audit log. Mounted under /admin.
 */
const router = Router();
router.use(requireUser, requireRole('admin'));

export const PARTNER_GATE_TARGET = 5; // Phase 3 gate: 5 partner shops check phones every week
const DAY_MS = 86400 * 1000;
const conflict = (code, message) => new HttpError(409, code, message);
const idParams = validate(z.object({ id: objectId }), 'params');
const userSummary = (u) => (u ? { id: u.id, name: u.name ?? null, phone: u.phone, role: u.role } : null);

async function usersById(ids) {
  const users = await User.find({ _id: { $in: ids.filter(Boolean) } });
  return (id) => userSummary(users.find((u) => u.id === String(id)));
}

// ---- Statistics and the Phase 3 gate ----

router.get('/registry/stats', async (_req, res) => {
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const monthAgo = new Date(Date.now() - 30 * DAY_MS);
  const [items, itemStatuses, reports, openDisputes, checksBySource, checksByResult, partners, partnerChecks] = await Promise.all([
    RegistryItem.countDocuments(),
    RegistryItem.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    TheftReport.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Dispute.countDocuments({ status: 'open' }),
    CheckLog.aggregate([{ $match: { createdAt: { $gte: weekAgo } } }, { $group: { _id: '$source', count: { $sum: 1 } } }]),
    CheckLog.aggregate([{ $match: { createdAt: { $gte: weekAgo } } }, { $group: { _id: '$result', count: { $sum: 1 } } }]),
    Partner.find().sort({ name: 1 }),
    CheckLog.aggregate([
      { $match: { partnerId: { $ne: null }, createdAt: { $gte: monthAgo } } },
      {
        $group: {
          _id: '$partnerId',
          checks30d: { $sum: 1 },
          checks7d: { $sum: { $cond: [{ $gte: ['$createdAt', weekAgo] }, 1, 0] } },
          flagged7d: {
            $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', weekAgo] }, { $in: ['$result', ['stolen', 'lost']] }] }, 1, 0] },
          },
          lastCheckAt: { $max: '$createdAt' },
        },
      },
    ]),
  ]);

  const byPartner = partners.map((p) => {
    const c = partnerChecks.find((x) => String(x._id) === p.id) ?? {};
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      district: p.district ?? null,
      status: p.status,
      checks7d: c.checks7d ?? 0,
      checks30d: c.checks30d ?? 0,
      flagged7d: c.flagged7d ?? 0,
      lastCheckAt: c.lastCheckAt ?? null,
    };
  });
  const activeShops = byPartner.filter((p) => p.status === 'active' && p.type !== 'police' && p.checks7d > 0).length;
  const toObject = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.count]));

  res.json({
    generatedAt: new Date(),
    gate: { activeShops, target: PARTNER_GATE_TARGET, passed: activeShops >= PARTNER_GATE_TARGET },
    items,
    itemStatuses: toObject(itemStatuses),
    reports: toObject(reports),
    openDisputes,
    checks7d: { bySource: toObject(checksBySource), byResult: toObject(checksByResult) },
    partners: byPartner,
  });
});

// ---- Stolen and lost reports ----

router.get(
  '/registry/reports',
  validate(z.object({ status: z.enum(REPORT_STATUSES).default('pending') }), 'query'),
  async (req, res) => {
    const { status } = req.valid.query;
    // The review queue is oldest first; other lists newest first.
    const reports = await TheftReport.find({ status }).sort({ createdAt: status === 'pending' ? 1 : -1 }).limit(100);
    const items = await RegistryItem.find({ _id: { $in: reports.map((r) => r.itemId) } });
    const user = await usersById(reports.map((r) => r.ownerId));
    const [previous, checks] = await Promise.all([
      TheftReport.aggregate([{ $match: { ownerId: { $in: reports.map((r) => r.ownerId) } } }, { $group: { _id: '$ownerId', count: { $sum: 1 } } }]),
      CheckLog.aggregate([{ $match: { itemId: { $in: items.map((i) => i._id) } } }, { $group: { _id: '$itemId', count: { $sum: 1 } } }]),
    ]);
    res.json({
      reports: reports.map((r) => {
        const item = items.find((i) => i.id === String(r.itemId));
        return {
          ...r.toPublic(),
          owner: user(r.ownerId),
          ownerReports: previous.find((p) => String(p._id) === String(r.ownerId))?.count ?? 1,
          item: item ? { ...item.toPublic(), checks: checks.find((c) => String(c._id) === item.id)?.count ?? 0 } : null,
        };
      }),
    });
  },
);

router.post(
  '/registry/reports/:id/review',
  idParams,
  validate(
    z
      .object({
        decision: z.enum(['approve', 'reject']),
        note: z.string().trim().max(500).optional(),
        proof: z.enum(['accepted', 'rejected']).optional(),
      })
      .refine((b) => b.decision === 'approve' || b.note, { message: 'Tell the owner why it was not approved', path: ['note'] }),
  ),
  async (req, res) => {
    const report = await TheftReport.findById(req.valid.params.id);
    if (!report) throw notFound('Report');
    if (report.status !== 'pending') throw conflict('already_reviewed', 'This report was already reviewed');
    const item = await RegistryItem.findById(report.itemId);
    if (!item) throw notFound('Registered device');

    const { decision, note, proof } = req.valid.body;
    Object.assign(report, {
      status: decision === 'approve' ? 'approved' : 'rejected',
      reviewedBy: req.user._id,
      reviewedAt: new Date(),
      reviewNote: note,
    });
    if (decision === 'approve') item.status = report.type;
    if (proof && item.proofs.length) item.proofStatus = proof;
    await Promise.all([report.save(), item.save()]);
    await audit(req, `report.${decision === 'approve' ? 'approved' : 'rejected'}`, report, { itemId: item.id, note, proof });
    await notifyOwner(item, decision === 'approve' ? 'report_approved' : 'report_rejected', { message: note });
    res.json({ report: report.toPublic(), item: item.toPublic() });
  },
);

// The team closes an approved report, for example when the police return the phone.
router.post(
  '/registry/reports/:id/close',
  idParams,
  validate(z.object({ reason: z.enum(['recovered', 'withdrawn']), note: z.string().trim().max(500).optional() })),
  async (req, res) => {
    const report = await TheftReport.findById(req.valid.params.id);
    if (!report || report.status !== 'approved') throw notFound('Approved report');
    const item = await RegistryItem.findById(report.itemId);
    Object.assign(report, { status: 'closed', closedAt: new Date(), closedReason: req.valid.body.reason });
    if (item) item.status = 'registered';
    await Promise.all([report.save(), item?.save()]);
    await audit(req, 'report.closed', report, { reason: req.valid.body.reason, note: req.valid.body.note, by: 'admin' });
    res.json({ report: report.toPublic() });
  },
);

// ---- Disputes ----

router.get(
  '/registry/disputes',
  validate(z.object({ status: z.enum(DISPUTE_STATUSES).default('open') }), 'query'),
  async (req, res) => {
    const { status } = req.valid.query;
    const disputes = await Dispute.find({ status }).sort({ createdAt: status === 'open' ? 1 : -1 }).limit(100);
    const items = await RegistryItem.find({ _id: { $in: disputes.map((d) => d.itemId) } });
    const reports = await TheftReport.find({ itemId: { $in: items.map((i) => i._id) }, status: { $in: ['pending', 'approved'] } });
    const user = await usersById([...disputes.map((d) => d.raisedBy), ...items.map((i) => i.ownerId)]);
    res.json({
      disputes: disputes.map((d) => {
        const item = items.find((i) => i.id === String(d.itemId));
        return {
          ...d.toPublic(),
          claimant: user(d.raisedBy),
          item: item ? item.toPublic() : null,
          owner: item ? user(item.ownerId) : null,
          openReport: reports.find((r) => String(r.itemId) === String(d.itemId))?.toPublic() ?? null,
        };
      }),
    });
  },
);

router.post(
  '/registry/disputes/:id/resolve',
  idParams,
  validate(
    z
      .object({
        outcome: z.enum(['upheld', 'rejected']),
        action: z.enum(DISPUTE_ACTIONS).default('none'),
        note: z.string().trim().min(3).max(500),
      })
      .refine((b) => b.outcome === 'upheld' || b.action === 'none', { message: 'A rejected dispute changes nothing', path: ['action'] }),
  ),
  async (req, res) => {
    const dispute = await Dispute.findById(req.valid.params.id);
    if (!dispute) throw notFound('Dispute');
    if (dispute.status !== 'open') throw conflict('already_resolved', 'This dispute was already resolved');
    const item = await RegistryItem.findById(dispute.itemId);
    if (!item) throw notFound('Registered device');
    const { outcome, action, note } = req.valid.body;
    const previousOwner = item.ownerId;

    if (action === 'close_report' || action === 'transfer_item') {
      const report = await openReportFor(item._id);
      if (report) {
        Object.assign(report, { status: 'closed', closedAt: new Date(), closedReason: action === 'transfer_item' ? 'transferred' : 'dispute' });
        await report.save();
      }
      item.status = 'registered';
    }
    if (action === 'transfer_item') {
      await Upload.deleteMany({ _id: { $in: item.proofs.map((p) => p.uploadId) } });
      Object.assign(item, { ownerId: dispute.raisedBy, proofs: [], proofStatus: 'none', deviceId: undefined, transfer: undefined });
    }
    await item.save();
    Object.assign(dispute, { status: outcome, action, resolution: note, resolvedBy: req.user._id, resolvedAt: new Date() });
    await dispute.save();
    await audit(req, `dispute.${outcome}`, dispute, { action, itemId: item.id, note });

    // Both sides hear about the decision.
    await notifyOwner(item, 'dispute_resolved', { userId: dispute.raisedBy, message: note });
    await notifyOwner(item, 'dispute_resolved', { userId: previousOwner, message: note });
    res.json({ dispute: dispute.toPublic(), item: item.toPublic() });
  },
);

// Proof files and dispute evidence. Opening one is logged: they are personal documents.
router.get('/registry/uploads/:id', idParams, async (req, res) => {
  const upload = await Upload.findById(req.valid.params.id);
  if (!upload) throw notFound('File');
  await audit(req, 'upload.viewed', upload);
  sendUpload(res, upload);
});

// Support: find a registered device by IMEI, serial or the owner's phone number.
router.get('/registry/items', validate(z.object({ q: z.string().trim().min(3).max(40) }), 'query'), async (req, res) => {
  const { q } = req.valid.query;
  const parsed = classifyQuery(q);
  const phone = normalizePhone(q);
  const or = [];
  if (parsed.kind === 'imei') or.push({ imeis: parsed.value });
  if (parsed.kind === 'serial') or.push({ serial: parsed.value });
  if (phone) {
    const owner = await User.findOne({ phone });
    if (owner) or.push({ ownerId: owner._id });
  }
  const items = or.length ? await RegistryItem.find({ $or: or }).limit(20) : [];
  const user = await usersById(items.map((i) => i.ownerId));
  const reports = await TheftReport.find({ itemId: { $in: items.map((i) => i._id) } }).sort({ createdAt: -1 });
  res.json({
    items: items.map((i) => ({
      ...i.toPublic(),
      owner: user(i.ownerId),
      reports: reports.filter((r) => String(r.itemId) === i.id).map((r) => r.toPublic()),
    })),
  });
});

// ---- Partners ----

async function partnerWithMembers(partner) {
  const members = await User.find({ partnerId: partner._id });
  return { ...partner.toPublic(), members: members.map(userSummary) };
}

router.get('/partners', async (_req, res) => {
  const partners = await Partner.find().sort({ name: 1 });
  res.json({ partners: await Promise.all(partners.map(partnerWithMembers)) });
});

const partnerFields = {
  name: z.string().trim().min(2).max(80),
  type: z.enum(PARTNER_TYPES),
  district: z.string().trim().max(40).optional(),
  contactPhone: z.string().trim().max(20).optional(),
};

function cleanContact(body) {
  if (body.contactPhone === undefined || body.contactPhone === '') return body;
  const phone = normalizePhone(body.contactPhone);
  if (!phone) throw badRequest('contact_invalid', 'Enter a valid phone number');
  return { ...body, contactPhone: phone };
}

router.post('/partners', validate(z.object({ ...partnerFields, type: partnerFields.type.default('shop') })), async (req, res) => {
  const partner = await Partner.create(cleanContact(req.valid.body));
  await audit(req, 'partner.created', partner, { name: partner.name, type: partner.type });
  res.status(201).json({ partner: await partnerWithMembers(partner) });
});

router.patch(
  '/partners/:id',
  idParams,
  validate(
    z.object({
      name: partnerFields.name.optional(),
      type: partnerFields.type.optional(),
      district: partnerFields.district,
      contactPhone: partnerFields.contactPhone,
      status: z.enum(['active', 'suspended']).optional(),
    }),
  ),
  async (req, res) => {
    const partner = await Partner.findById(req.valid.params.id);
    if (!partner) throw notFound('Partner');
    Object.assign(partner, cleanContact(req.valid.body));
    await partner.save();
    await audit(req, 'partner.updated', partner, req.valid.body);
    res.json({ partner: await partnerWithMembers(partner) });
  },
);

// Adds a member by phone number. People who never signed in get an account they can sign in to later.
router.post(
  '/partners/:id/members',
  idParams,
  validate(z.object({ phone: z.string().trim().min(5).max(20), name: z.string().trim().max(80).optional() })),
  async (req, res) => {
    const partner = await Partner.findById(req.valid.params.id);
    if (!partner) throw notFound('Partner');
    const phone = normalizePhone(req.valid.body.phone);
    if (!phone) throw badRequest('phone_invalid', 'Enter a valid phone number');
    let user = await User.findOne({ phone });
    if (user?.role === 'admin') throw badRequest('member_admin', 'NexGuard team members cannot join a partner');
    if (user?.partnerId && String(user.partnerId) !== partner.id) throw conflict('member_elsewhere', 'This person belongs to another partner');
    const role = partner.type === 'police' ? 'police' : 'shop';
    if (user) Object.assign(user, { role, partnerId: partner._id });
    else user = new User({ phone, name: req.valid.body.name, role, partnerId: partner._id });
    await user.save();
    await audit(req, 'partner.member_added', partner, { userId: user.id });
    res.status(201).json({ partner: await partnerWithMembers(partner) });
  },
);

router.delete(
  '/partners/:id/members/:userId',
  validate(z.object({ id: objectId, userId: objectId }), 'params'),
  async (req, res) => {
    const partner = await Partner.findById(req.valid.params.id);
    if (!partner) throw notFound('Partner');
    const user = await User.findOne({ _id: req.valid.params.userId, partnerId: partner._id });
    if (!user) throw notFound('Member');
    user.role = 'owner';
    user.partnerId = undefined;
    // Signs them out, so the partner portal closes at once.
    user.tokenVersion += 1;
    await user.save();
    await audit(req, 'partner.member_removed', partner, { userId: user.id });
    res.json({ partner: await partnerWithMembers(partner) });
  },
);

// ---- Audit log ----

router.get(
  '/audit',
  validate(
    z.object({
      action: z.string().trim().max(40).optional(),
      targetId: objectId.optional(),
      before: z.coerce.date().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    'query',
  ),
  async (req, res) => {
    const { action, targetId, before, limit } = req.valid.query;
    const filter = {};
    // "report" matches report.created, report.approved...; "report.approved" matches exactly.
    if (action) filter.action = action.includes('.') ? action : { $regex: `^${action.replace(/[^a-z_]/gi, '')}\\.` };
    if (targetId) filter.targetId = targetId;
    if (before) filter.createdAt = { $lt: before };
    const entries = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    const user = await usersById(entries.map((e) => e.actorId));
    const partners = await Partner.find({ _id: { $in: entries.map((e) => e.partnerId).filter(Boolean) } }).select('name');
    res.json({
      entries: entries.map((e) => ({
        id: String(e._id),
        action: e.action,
        actor: user(e.actorId),
        actorRole: e.actorRole ?? null,
        partner: e.partnerId ? (partners.find((p) => p.id === String(e.partnerId))?.name ?? null) : null,
        targetType: e.targetType ?? null,
        targetId: e.targetId ? String(e.targetId) : null,
        details: e.details ?? null,
        createdAt: e.createdAt,
      })),
    });
  },
);

export default router;
