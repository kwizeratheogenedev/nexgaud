import { Router } from 'express';
import { z } from 'zod';
import { Family, MAX_FAMILY_MEMBERS } from '../models/Family.js';
import { Device } from '../models/Device.js';
import { User } from '../models/User.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { objectId, validate } from '../lib/validate.js';
import { requireUser } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { familyOf } from '../services/access.js';
import { familyActive } from '../services/plans.js';

/**
 * Family sharing (Family plan). The owner adds people; each person chooses which of their phones to share
 * (PATCH /devices/:id { familyShared }). Members can leave at any time.
 */
const router = Router();
router.use(requireUser);

async function view(family, me) {
  const users = await User.find({ _id: { $in: family.everyone() } }).select('name phone');
  const shared = await Device.aggregate([
    { $match: { ownerId: { $in: family.everyone() }, orgId: null, familyShared: true } },
    { $group: { _id: '$ownerId', count: { $sum: 1 } } },
  ]);
  const person = (id, role) => {
    const u = users.find((x) => x.id === String(id));
    return { id: String(id), name: u?.name ?? null, phone: u?.phone ?? null, role, sharedDevices: shared.find((s) => String(s._id) === String(id))?.count ?? 0 };
  };
  return {
    id: family.id,
    name: family.name ?? null,
    isOwner: String(family.ownerId) === String(me._id),
    planActive: await familyActive(family.ownerId),
    people: [person(family.ownerId, 'owner'), ...family.members.map((m) => person(m.userId, 'member'))],
    maxMembers: MAX_FAMILY_MEMBERS,
  };
}

router.get('/', async (req, res) => {
  const family = await familyOf(req.user._id);
  res.json({ family: family ? await view(family, req.user) : null });
});

router.post('/', validate(z.object({ name: z.string().trim().max(60).optional() })), async (req, res) => {
  if (await familyOf(req.user._id)) throw new HttpError(409, 'already_in_family', 'You are already in a family');
  const family = await Family.create({ ownerId: req.user._id, name: req.valid.body.name, members: [] });
  res.status(201).json({ family: await view(family, req.user) });
});

router.post('/members', validate(z.object({ phone: z.string().trim().min(5).max(20) })), async (req, res) => {
  const family = await Family.findOne({ ownerId: req.user._id });
  if (!family) throw notFound('Family');
  if (!(await familyActive(req.user._id))) throw new HttpError(402, 'plan_needed', 'Adding people needs the Family plan');
  if (family.members.length >= MAX_FAMILY_MEMBERS) throw badRequest('member_limit', `Up to ${MAX_FAMILY_MEMBERS} people besides you`);
  const phone = normalizePhone(req.valid.body.phone);
  if (!phone) throw badRequest('phone_invalid', 'Enter a valid phone number');
  let user = await User.findOne({ phone });
  if (user && String(user._id) === req.user.id) throw badRequest('self', 'You are already in your family');
  if (user && (await familyOf(user._id))) throw new HttpError(409, 'in_other_family', 'This person is already in a family');
  user ??= await User.create({ phone });
  family.members.push({ userId: user._id });
  await family.save();
  await audit(req, 'family.member_added', family, { userId: user.id });
  res.status(201).json({ family: await view(family, req.user) });
});

// The owner removes someone, or a member leaves.
router.delete('/members/:userId', validate(z.object({ userId: objectId }), 'params'), async (req, res) => {
  const family = await familyOf(req.user._id);
  if (!family) throw notFound('Family');
  const isOwner = String(family.ownerId) === req.user.id;
  const target = req.valid.params.userId;
  if (!isOwner && target !== req.user.id) throw notFound('Family member');
  const before = family.members.length;
  family.members = family.members.filter((m) => String(m.userId) !== target);
  if (family.members.length === before) throw notFound('Family member');
  await family.save();
  await audit(req, 'family.member_removed', family, { userId: target });
  res.json({ family: isOwner ? await view(family, req.user) : null });
});

router.delete('/', async (req, res) => {
  const family = await Family.findOne({ ownerId: req.user._id });
  if (!family) throw notFound('Family');
  await family.deleteOne();
  await audit(req, 'family.deleted', family);
  res.status(204).end();
});

export default router;
