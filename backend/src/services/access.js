import { Org } from '../models/Org.js';
import { Family } from '../models/Family.js';
import { familyActive } from './plans.js';

/** The active organisations this user manages. */
export async function managedOrgIds(user) {
  return Org.find({ status: 'active', 'members.userId': user._id }).distinct('_id');
}

/** The user's family, if any (as owner or member). */
export function familyOf(userId) {
  return Family.findOne({ $or: [{ ownerId: userId }, { 'members.userId': userId }] });
}

/** The other people in the user's family, while the family owner's plan is active. */
export async function familyMemberIds(user) {
  const family = await familyOf(user._id);
  if (!family || !(await familyActive(family.ownerId))) return [];
  return family.everyone().filter((id) => String(id) !== String(user._id));
}

/**
 * A query filter for the devices or tags this user may see:
 * their personal ones (no orgId) plus those of organisations they manage.
 * With family: true, also the phones family members chose to share (to view, ring and locate only).
 */
export async function scopeFor(user, { family = false } = {}) {
  const orgIds = await managedOrgIds(user);
  const familyIds = family ? await familyMemberIds(user) : [];
  return {
    $or: [
      { ownerId: user._id, orgId: null },
      ...(orgIds.length ? [{ orgId: { $in: orgIds } }] : []),
      ...(familyIds.length ? [{ ownerId: { $in: familyIds }, orgId: null, familyShared: true }] : []),
    ],
  };
}

/** Who hears about something that happens to a device or tag: its owner, or every manager of its organisation. */
export async function recipientsFor(thing) {
  if (!thing.orgId) return thing.ownerId ? [thing.ownerId] : [];
  const org = await Org.findById(thing.orgId);
  return org?.status === 'active' ? org.members.map((m) => m.userId) : [];
}
