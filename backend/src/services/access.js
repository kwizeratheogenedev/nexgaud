import { Org } from '../models/Org.js';

/** The active organisations this user manages. */
export async function managedOrgIds(user) {
  return Org.find({ status: 'active', 'members.userId': user._id }).distinct('_id');
}

/**
 * A query filter for the devices or tags this user may see and control:
 * their personal ones (no orgId) plus those of organisations they manage.
 */
export async function scopeFor(user) {
  const orgIds = await managedOrgIds(user);
  return { $or: [{ ownerId: user._id, orgId: null }, ...(orgIds.length ? [{ orgId: { $in: orgIds } }] : [])] };
}

/** Who hears about something that happens to a device or tag: its owner, or every manager of its organisation. */
export async function recipientsFor(thing) {
  if (!thing.orgId) return thing.ownerId ? [thing.ownerId] : [];
  const org = await Org.findById(thing.orgId);
  return org?.status === 'active' ? org.members.map((m) => m.userId) : [];
}
