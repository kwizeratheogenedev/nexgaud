import { config } from '../config.js';
import { Subscription } from '../models/Billing.js';
import { Device } from '../models/Device.js';
import { updateRetention } from '../models/Location.js';
import { logger } from '../logger.js';

/**
 * What each plan gives, and whether someone has it right now.
 * Rule: a lapsed plan never switches off protection already running. It only stops paid extras
 * (family sharing, longer history, adding laptops beyond the free ones).
 */
export const GRACE_DAYS = 7;
export const FREE_HISTORY_DAYS = 30;
export const FAMILY_HISTORY_DAYS = 90;
export const ALLOWED_MONTHS = [1, 3, 6, 12];
const DAY_MS = 86400 * 1000;

export const prices = () => ({
  family: config.PRICE_FAMILY_MONTHLY_RWF,
  laptopSeat: config.PRICE_LAPTOP_SEAT_MONTHLY_RWF,
  orgFreeLaptops: config.ORG_FREE_LAPTOPS,
  currency: 'RWF',
});

const isActive = (sub, now = Date.now()) => Boolean(sub && sub.paidUntil.getTime() + GRACE_DAYS * DAY_MS > now);

export async function familySubscription(userId) {
  return Subscription.findOne({ subjectType: 'user', subjectId: userId, plan: 'family' });
}

export async function familyActive(userId) {
  return isActive(await familySubscription(userId));
}

/** An organisation's laptop allowance: the free ones plus the seats paid for. */
export async function orgSeats(orgId) {
  const sub = await Subscription.findOne({ subjectType: 'org', subjectId: orgId, plan: 'org_seats' });
  const active = isActive(sub);
  const paid = active ? sub.seats : 0;
  return {
    free: config.ORG_FREE_LAPTOPS,
    paid,
    limit: config.ORG_FREE_LAPTOPS + paid,
    seatsBought: sub?.seats ?? 0,
    paidUntil: sub?.paidUntil ?? null,
    active,
    inGrace: Boolean(sub && active && sub.paidUntil.getTime() < Date.now()),
  };
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** Days left on an active subscription, for pricing extra seats until its end. */
export const daysLeft = (paidUntil, now = Date.now()) => Math.max(0, Math.ceil((paidUntil.getTime() - now) / DAY_MS));

/** Rounds up to the next 100 RWF, so prorated prices are easy to read and pay. */
export const roundPrice = (amount) => Math.ceil(amount / 100) * 100;

/** Gives the person their longer history (or takes it back) on all their personal devices. */
export async function applyHistory(userId, days) {
  const devices = await Device.find({ ownerId: userId, orgId: null });
  for (const device of devices) {
    if ((device.historyDays ?? FREE_HISTORY_DAYS) === days) continue;
    device.historyDays = days === FREE_HISTORY_DAYS ? undefined : days;
    await device.save();
    await updateRetention(device);
  }
}

/** Applies a paid invoice: extends the plan from today or from the current end, whichever is later. */
export async function applyPurchase(invoice) {
  const { plan, months, seats, addSeats } = invoice.product;
  const filter = { subjectType: invoice.subjectType, subjectId: invoice.subjectId, plan };
  const current = await Subscription.findOne(filter);
  const now = new Date();
  const base = current && current.paidUntil > now ? current.paidUntil : now;

  if (plan === 'org_seats' && addSeats) {
    // Extra seats until the current end date (they were priced for the days left).
    await Subscription.updateOne(filter, { $inc: { seats } });
  } else {
    await Subscription.updateOne(
      filter,
      { $set: { paidUntil: addMonths(base, months), ...(plan === 'org_seats' ? { seats } : {}) } },
      { upsert: true },
    );
  }
  if (plan === 'family') await applyHistory(invoice.subjectId, FAMILY_HISTORY_DAYS);
}

/** Hourly: people whose Family plan ended (after the grace days) go back to 30 days of history. */
export async function expireLapsedPlans() {
  const owners = await Device.find({ historyDays: FAMILY_HISTORY_DAYS }).distinct('ownerId');
  let changed = 0;
  for (const ownerId of owners) {
    if (!(await familyActive(ownerId))) {
      await applyHistory(ownerId, FREE_HISTORY_DAYS);
      changed++;
    }
  }
  if (changed) logger.info({ changed }, 'Family plans ended: history back to 30 days');
  return changed;
}
