import { Router } from 'express';
import { z } from 'zod';
import { Org, ORG_TYPES, MAX_ORG_MEMBERS } from '../models/Org.js';
import { Device } from '../models/Device.js';
import { Tag } from '../models/Tag.js';
import { User } from '../models/User.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { objectId, validate } from '../lib/validate.js';
import { requireUser } from '../middleware/auth.js';
import { audit } from '../services/audit.js';

/**
 * Organisations (schools, companies): anyone can start one and add the people who manage it.
 * Managers see and control the organisation's laptops and tags, never each other's personal devices.
 */
const router = Router();
router.use(requireUser);

const MAX_ORGS_CREATED = 3;
const idParams = validate(z.object({ id: objectId }), 'params');

async function myOrg(req) {
  const org = await Org.findOne({ _id: req.valid.params.id, 'members.userId': req.user._id });
  if (!org) throw notFound('Organisation');
  if (org.status !== 'active') throw new HttpError(403, 'org_suspended', 'This organisation is suspended. Contact NexGuard.');
  return org;
}

async function full(org) {
  const [users, devices, tags] = await Promise.all([
    User.find({ _id: { $in: org.members.map((m) => m.userId) } }).select('name phone'),
    Device.countDocuments({ orgId: org._id }),
    Tag.countDocuments({ orgId: org._id, status: { $ne: 'disabled' } }),
  ]);
  return {
    ...org.toPublic(),
    members: org.members.map((m) => {
      const u = users.find((x) => x.id === String(m.userId));
      return { id: String(m.userId), name: u?.name ?? null, phone: u?.phone ?? null, addedAt: m.addedAt };
    }),
    devices,
    tags,
  };
}

router.get('/', async (req, res) => {
  const orgs = await Org.find({ 'members.userId': req.user._id }).sort({ createdAt: 1 });
  res.json({ orgs: await Promise.all(orgs.map(full)) });
});

const orgFields = {
  name: z.string().trim().min(2).max(80),
  type: z.enum(ORG_TYPES),
  district: z.string().trim().max(40).optional(),
};

router.post('/', validate(z.object({ ...orgFields, type: orgFields.type.default('school') })), async (req, res) => {
  if ((await Org.countDocuments({ createdBy: req.user._id })) >= MAX_ORGS_CREATED) {
    throw badRequest('org_limit', `You can start up to ${MAX_ORGS_CREATED} organisations`);
  }
  const org = await Org.create({ ...req.valid.body, createdBy: req.user._id, members: [{ userId: req.user._id }] });
  await audit(req, 'org.created', org, { name: org.name, type: org.type });
  res.status(201).json({ org: await full(org) });
});

router.patch(
  '/:id',
  idParams,
  validate(z.object({ name: orgFields.name.optional(), type: orgFields.type.optional(), district: orgFields.district })),
  async (req, res) => {
    const org = await myOrg(req);
    Object.assign(org, req.valid.body);
    await org.save();
    await audit(req, 'org.updated', org, req.valid.body);
    res.json({ org: await full(org) });
  },
);

// Adds a manager by phone number. People who never signed in get an account they can sign in to later.
router.post(
  '/:id/members',
  idParams,
  validate(z.object({ phone: z.string().trim().min(5).max(20), name: z.string().trim().max(80).optional() })),
  async (req, res) => {
    const org = await myOrg(req);
    const phone = normalizePhone(req.valid.body.phone);
    if (!phone) throw badRequest('phone_invalid', 'Enter a valid phone number');
    if (org.members.length >= MAX_ORG_MEMBERS) throw badRequest('member_limit', `Up to ${MAX_ORG_MEMBERS} managers`);
    let user = await User.findOne({ phone });
    if (!user) user = await User.create({ phone, name: req.valid.body.name });
    if (org.members.some((m) => String(m.userId) === user.id)) throw new HttpError(409, 'already_member', 'Already a manager');
    org.members.push({ userId: user._id });
    await org.save();
    await audit(req, 'org.member_added', org, { userId: user.id });
    res.status(201).json({ org: await full(org) });
  },
);

// Removes a manager (or yourself, to leave). The last manager cannot leave.
router.delete('/:id/members/:userId', validate(z.object({ id: objectId, userId: objectId }), 'params'), async (req, res) => {
  const org = await myOrg(req);
  const index = org.members.findIndex((m) => String(m.userId) === req.valid.params.userId);
  if (index < 0) throw notFound('Manager');
  if (org.members.length === 1) throw badRequest('last_member', 'An organisation needs at least one manager');
  org.members.splice(index, 1);
  await org.save();
  await audit(req, 'org.member_removed', org, { userId: req.valid.params.userId });
  res.json({ org: String(req.valid.params.userId) === req.user.id ? null : await full(org) });
});

export default router;
