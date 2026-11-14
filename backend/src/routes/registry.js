import { Router } from 'express';
import { z } from 'zod';
import { RegistryItem, ITEM_KINDS, MAX_ITEMS_PER_USER, MAX_PROOFS, PROOF_KINDS } from '../models/RegistryItem.js';
import { TheftReport, REPORT_TYPES } from '../models/TheftReport.js';
import { Dispute, DISPUTE_REASONS } from '../models/Dispute.js';
import { Device } from '../models/Device.js';
import { Upload } from '../models/Upload.js';
import { randomInt } from 'node:crypto';
import { hmac, safeEqualHex } from '../lib/crypto.js';
import { badRequest, HttpError, notFound, tooMany } from '../lib/errors.js';
import { classifyQuery, IMEI_ERRORS, normalizeSerial, parseImei } from '../lib/imei.js';
import { objectId, validate } from '../lib/validate.js';
import { rawUpload, saveUpload, sendUpload } from '../lib/upload.js';
import { requireUser } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { findItems, notifyOwner, openReportFor } from '../services/registry.js';

// Owners: register devices by IMEI or serial, add proof, report them stolen, sell them, dispute.
const router = Router();
router.use(requireUser);

const TRANSFER_TTL_MS = 72 * 3600 * 1000;
const TRANSFER_MAX_ATTEMPTS = 5;
const MAX_OPEN_DISPUTES = 3;

// 8 characters without look-alikes (no 0/O, 1/I/L), easy to read out over the phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const transferCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

const conflict = (code, message) => new HttpError(409, code, message);
const idParams = validate(z.object({ id: objectId }), 'params');

async function ownedItem(req) {
  const item = await RegistryItem.findOne({ _id: req.valid.params.id, ownerId: req.user._id });
  if (!item) throw notFound('Registered device');
  return item;
}

const imeiField = z.string().transform((v, ctx) => {
  const parsed = parseImei(v);
  if (parsed.error) {
    ctx.addIssue({ code: 'custom', message: IMEI_ERRORS[parsed.error] });
    return z.NEVER;
  }
  return parsed.imei;
});

const serialField = z.string().transform((v, ctx) => {
  const serial = normalizeSerial(v);
  if (!serial) {
    ctx.addIssue({ code: 'custom', message: 'A serial number has 5 to 30 letters and digits' });
    return z.NEVER;
  }
  return serial;
});

/** Items with their latest report and the user's own open disputes, for the owner's list. */
async function withReports(items) {
  const reports = await TheftReport.find({ itemId: { $in: items.map((i) => i._id) } }).sort({ createdAt: -1 });
  return items.map((item) => {
    const report = reports.find((r) => String(r.itemId) === item.id);
    return { ...item.toPublic(), report: report?.toPublic() ?? null };
  });
}

router.get('/items', async (req, res) => {
  const items = await RegistryItem.find({ ownerId: req.user._id }).sort({ createdAt: -1 });
  res.json({ items: await withReports(items) });
});

router.post(
  '/items',
  validate(
    z
      .object({
        kind: z.enum(ITEM_KINDS).default('phone'),
        brand: z.string().trim().min(1).max(40),
        model: z.string().trim().max(60).optional(),
        color: z.string().trim().max(30).optional(),
        imeis: z.array(imeiField).max(2).default([]),
        serial: serialField.optional(),
        deviceId: objectId.optional(),
      })
      .refine((b) => b.imeis.length > 0 || b.serial, { message: 'Enter an IMEI or a serial number', path: ['imeis'] })
      .refine((b) => new Set(b.imeis).size === b.imeis.length, { message: 'The two IMEIs are the same', path: ['imeis'] }),
  ),
  async (req, res) => {
    const body = req.valid.body;
    if ((await RegistryItem.countDocuments({ ownerId: req.user._id })) >= MAX_ITEMS_PER_USER) {
      throw badRequest('item_limit', `You can register up to ${MAX_ITEMS_PER_USER} devices`);
    }
    if (body.deviceId && !(await Device.exists({ _id: body.deviceId, ownerId: req.user._id }))) {
      throw notFound('Device');
    }
    const brandKey = body.brand.toLowerCase();
    // Someone else already registered this IMEI or serial: they can open a dispute instead.
    const taken = await RegistryItem.findOne({
      $or: [
        ...(body.imeis.length ? [{ imeis: { $in: body.imeis } }] : []),
        ...(body.serial ? [{ serial: body.serial, brandKey }] : []),
      ],
    });
    if (taken) {
      const mine = String(taken.ownerId) === String(req.user._id);
      throw conflict(
        mine ? 'already_yours' : 'already_registered',
        mine ? 'You have already registered this device' : 'This device is registered to someone else. If it is yours, open a dispute.',
      );
    }
    const item = await RegistryItem.create({
      ...body,
      imeis: body.imeis.length ? body.imeis : undefined,
      brandKey: body.serial ? brandKey : undefined,
      ownerId: req.user._id,
    });
    await audit(req, 'item.registered', item, { imeis: item.imeis?.length ?? 0, serial: Boolean(item.serial) });
    res.status(201).json({ item: { ...item.toPublic(), report: null } });
  },
);

router.patch(
  '/items/:id',
  idParams,
  validate(
    z.object({
      model: z.string().trim().max(60).optional(),
      color: z.string().trim().max(30).optional(),
      deviceId: objectId.nullable().optional(),
    }),
  ),
  async (req, res) => {
    const item = await ownedItem(req);
    const { deviceId, ...rest } = req.valid.body;
    if (deviceId && !(await Device.exists({ _id: deviceId, ownerId: req.user._id }))) throw notFound('Device');
    Object.assign(item, rest);
    if (deviceId !== undefined) item.deviceId = deviceId ?? undefined;
    await item.save();
    const [full] = await withReports([item]);
    res.json({ item: full });
  },
);

router.delete('/items/:id', idParams, async (req, res) => {
  const item = await ownedItem(req);
  if (await openReportFor(item._id)) throw conflict('report_open', 'Close the stolen or lost report first');
  await Upload.deleteMany({ _id: { $in: item.proofs.map((p) => p.uploadId) } });
  await item.deleteOne();
  await audit(req, 'item.deleted', item, { label: item.label() });
  res.status(204).end();
});

// Proof of ownership: a photo of the box (with the IMEI label) or the receipt.
router.post(
  '/items/:id/proofs',
  idParams,
  validate(z.object({ kind: z.enum(PROOF_KINDS).default('other') }), 'query'),
  rawUpload,
  async (req, res) => {
    const item = await ownedItem(req);
    if (item.proofs.length >= MAX_PROOFS) throw badRequest('proof_limit', `You can add up to ${MAX_PROOFS} files`);
    const upload = await saveUpload(req, req.user._id);
    item.proofs.push({ uploadId: upload._id, kind: req.valid.query.kind, mime: upload.mime, size: upload.size });
    if (['none', 'rejected'].includes(item.proofStatus)) item.proofStatus = 'submitted';
    await item.save();
    await audit(req, 'item.proof_added', item, { kind: req.valid.query.kind });
    const [full] = await withReports([item]);
    res.status(201).json({ item: full });
  },
);

const proofParams = validate(z.object({ id: objectId, proofId: objectId }), 'params');

router.get('/items/:id/proofs/:proofId', proofParams, async (req, res) => {
  const item = await ownedItem(req);
  const proof = item.proofs.id(req.valid.params.proofId);
  const upload = proof && (await Upload.findById(proof.uploadId));
  if (!upload) throw notFound('File');
  sendUpload(res, upload);
});

router.delete('/items/:id/proofs/:proofId', proofParams, async (req, res) => {
  const item = await ownedItem(req);
  const proof = item.proofs.id(req.valid.params.proofId);
  if (!proof) throw notFound('File');
  await Upload.deleteOne({ _id: proof.uploadId });
  proof.deleteOne();
  if (!item.proofs.length) item.proofStatus = 'none';
  await item.save();
  const [full] = await withReports([item]);
  res.json({ item: full });
});

// Reporting a device stolen or lost. The team reviews it before checks show it.
router.post(
  '/items/:id/reports',
  idParams,
  validate(
    z
      .object({
        type: z.enum(REPORT_TYPES),
        incidentAt: z.coerce.date().refine((d) => d <= new Date(Date.now() + 5 * 60000), 'The date cannot be in the future'),
        place: z.string().trim().min(2).max(120),
        description: z.string().trim().max(1000).optional(),
        policeCaseNumber: z.string().trim().max(40).optional(),
        policeStation: z.string().trim().max(80).optional(),
      })
      .refine((b) => b.type !== 'stolen' || b.policeCaseNumber, {
        message: 'A stolen report needs the police case number (RIB)',
        path: ['policeCaseNumber'],
      }),
  ),
  async (req, res) => {
    const item = await ownedItem(req);
    if (await openReportFor(item._id)) throw conflict('report_open', 'This device already has an open report');
    if (item.transferOpen()) item.transfer = undefined; // a stolen phone cannot be handed over
    const report = await TheftReport.create({ ...req.valid.body, itemId: item._id, ownerId: req.user._id });
    await item.save();
    await audit(req, 'report.created', report, { type: report.type, itemId: item.id });
    const [full] = await withReports([item]);
    res.status(201).json({ item: full });
  },
);

router.post(
  '/items/:id/reports/close',
  idParams,
  validate(z.object({ reason: z.enum(['recovered', 'withdrawn']) })),
  async (req, res) => {
    const item = await ownedItem(req);
    const report = await openReportFor(item._id);
    if (!report) throw notFound('Open report');
    Object.assign(report, { status: 'closed', closedAt: new Date(), closedReason: req.valid.body.reason });
    item.status = 'registered';
    await Promise.all([report.save(), item.save()]);
    await audit(req, 'report.closed', report, { reason: req.valid.body.reason });
    const [full] = await withReports([item]);
    res.json({ item: full });
  },
);

// Selling: the owner gets a code to give the buyer, valid 72 hours. The buyer claims the device with it.
router.post('/items/:id/transfer', idParams, async (req, res) => {
  const item = await ownedItem(req);
  if (await openReportFor(item._id)) throw conflict('report_open', 'A device with an open report cannot be handed over');
  const code = transferCode();
  item.transfer = { codeHash: hmac(`transfer:${item.id}:${code}`), expiresAt: new Date(Date.now() + TRANSFER_TTL_MS), attempts: 0 };
  await item.save();
  await audit(req, 'transfer.started', item);
  res.status(201).json({ code, expiresAt: item.transfer.expiresAt });
});

router.delete('/items/:id/transfer', idParams, async (req, res) => {
  const item = await ownedItem(req);
  item.transfer = undefined;
  await item.save();
  res.status(204).end();
});

router.post(
  '/claim',
  validate(z.object({ identifier: z.string().trim().min(5).max(40), code: z.string().trim().min(8).max(8) })),
  async (req, res) => {
    const parsed = classifyQuery(req.valid.body.identifier);
    if (parsed.kind === 'invalid') throw badRequest('invalid_identifier', IMEI_ERRORS[parsed.reason]);
    const items = (await findItems(parsed)).filter((i) => i.transferOpen());
    const item = items[0];
    if (!item) throw badRequest('transfer_invalid', 'No handover is waiting for this device, or the code has expired');
    if (String(item.ownerId) === String(req.user._id)) throw badRequest('transfer_own', 'This device is already yours');

    const given = hmac(`transfer:${item.id}:${req.valid.body.code.toUpperCase()}`);
    if (!safeEqualHex(given, item.transfer.codeHash)) {
      item.transfer.attempts += 1;
      if (item.transfer.attempts >= TRANSFER_MAX_ATTEMPTS) item.transfer = undefined;
      await item.save();
      throw item.transfer ? badRequest('transfer_code', 'Wrong code') : tooMany('Too many wrong codes. Ask the seller for a new one.');
    }

    const previousOwner = item.ownerId;
    // Proof files carry the seller's name and the device leaves their tracked phones: neither moves with it.
    await Upload.deleteMany({ _id: { $in: item.proofs.map((p) => p.uploadId) } });
    Object.assign(item, { ownerId: req.user._id, proofs: [], proofStatus: 'none', deviceId: undefined, transfer: undefined });
    await item.save();
    await audit(req, 'transfer.completed', item, { from: String(previousOwner) });
    await notifyOwner(item, 'item_transferred', { userId: previousOwner });
    res.json({ item: { ...item.toPublic(), report: null } });
  },
);

// Disputes: "this device is mine" or "I bought it legally but it shows as reported".
router.get('/disputes', async (req, res) => {
  const disputes = await Dispute.find({ raisedBy: req.user._id }).sort({ createdAt: -1 }).limit(50);
  const items = await RegistryItem.find({ _id: { $in: disputes.map((d) => d.itemId) } }).select('brand model');
  res.json({
    disputes: disputes.map((d) => ({ ...d.toPublic(), device: items.find((i) => i.id === String(d.itemId))?.label() ?? null })),
  });
});

router.post(
  '/disputes',
  validate(
    z.object({
      identifier: z.string().trim().min(5).max(40),
      reason: z.enum(DISPUTE_REASONS),
      message: z.string().trim().min(10).max(1000),
    }),
  ),
  async (req, res) => {
    const { identifier, reason, message } = req.valid.body;
    const parsed = classifyQuery(identifier);
    if (parsed.kind === 'invalid') throw badRequest('invalid_identifier', IMEI_ERRORS[parsed.reason]);
    const [item] = await findItems(parsed);
    if (!item) throw notFound('Registered device');
    if (String(item.ownerId) === String(req.user._id)) throw badRequest('dispute_own', 'This device is already yours');
    if (await Dispute.exists({ itemId: item._id, raisedBy: req.user._id, status: 'open' })) {
      throw conflict('dispute_open', 'You already have an open dispute about this device');
    }
    if ((await Dispute.countDocuments({ raisedBy: req.user._id, status: 'open' })) >= MAX_OPEN_DISPUTES) {
      throw badRequest('dispute_limit', `You can have up to ${MAX_OPEN_DISPUTES} open disputes`);
    }
    const dispute = await Dispute.create({ itemId: item._id, raisedBy: req.user._id, reason, message });
    await audit(req, 'dispute.opened', dispute, { reason, itemId: item.id });
    res.status(201).json({ dispute: { ...dispute.toPublic(), device: item.label() } });
  },
);

router.post('/disputes/:id/evidence', idParams, rawUpload, async (req, res) => {
  const dispute = await Dispute.findOne({ _id: req.valid.params.id, raisedBy: req.user._id, status: 'open' });
  if (!dispute) throw notFound('Open dispute');
  if (dispute.evidence.length >= MAX_PROOFS) throw badRequest('proof_limit', `You can add up to ${MAX_PROOFS} files`);
  const upload = await saveUpload(req, req.user._id);
  dispute.evidence.push(upload._id);
  await dispute.save();
  res.status(201).json({ dispute: dispute.toPublic() });
});

export default router;
