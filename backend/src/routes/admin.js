import { Router } from 'express';
import { User } from '../models/User.js';
import { Device } from '../models/Device.js';
import { Alert } from '../models/Alert.js';
import { requireRole, requireUser } from '../middleware/auth.js';

// Pilot statistics for the NexGuard team. Counts and phone models only: no locations, no phone numbers.
const router = Router();
router.use(requireUser, requireRole('admin'));

export const PILOT_TARGET_USERS = 50;
export const PILOT_TARGET_SEEN_PCT = 90;
const DAY_MS = 86400 * 1000;

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

router.get('/stats', async (_req, res) => {
  const since = new Date(Date.now() - DAY_MS);
  const seenExpr = { $cond: [{ $gte: ['$lastSeenAt', since] }, 1, 0] };

  const [users, devices, seen24h, byBrand, byOs, statuses, permissionIssues, alerts7d, quiet] = await Promise.all([
    User.countDocuments({ role: 'owner' }),
    Device.countDocuments(),
    Device.countDocuments({ lastSeenAt: { $gte: since } }),
    Device.aggregate([
      { $group: { _id: { $toLower: { $ifNull: ['$brand', 'unknown'] } }, devices: { $sum: 1 }, seen24h: { $sum: seenExpr } } },
      { $sort: { devices: -1 } },
    ]),
    Device.aggregate([
      { $group: { _id: { $ifNull: ['$osVersion', 'unknown'] }, devices: { $sum: 1 }, seen24h: { $sum: seenExpr } } },
      { $sort: { _id: 1 } },
    ]),
    Device.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Device.aggregate([
      {
        $group: {
          _id: null,
          locationNotAlways: { $sum: { $cond: [{ $ne: ['$permissions.location', 'always'] }, 1, 0] } },
          batteryOptimized: { $sum: { $cond: [{ $eq: ['$permissions.batteryOptimized', true] }, 1, 0] } },
          notificationsOff: { $sum: { $cond: [{ $eq: ['$permissions.notifications', false] }, 1, 0] } },
          remoteLockOff: { $sum: { $cond: [{ $ne: ['$permissions.deviceAdmin', true] }, 1, 0] } },
        },
      },
    ]),
    Alert.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 7 * DAY_MS) } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    // Devices not seen for a day: which phones and Android versions lose tracking.
    Device.find({ $or: [{ lastSeenAt: { $lt: since } }, { lastSeenAt: null }] })
      .sort({ lastSeenAt: 1 })
      .limit(50)
      .select('brand model osVersion appVersion lastSeenAt permissions')
      .lean(),
  ]);

  const seenPct = pct(seen24h, devices);
  const issues = permissionIssues[0] ?? {};
  delete issues._id;

  res.json({
    generatedAt: new Date(),
    pilotGate: {
      users,
      usersTarget: PILOT_TARGET_USERS,
      seenPct,
      seenTarget: PILOT_TARGET_SEEN_PCT,
      passed: users >= PILOT_TARGET_USERS && seenPct >= PILOT_TARGET_SEEN_PCT,
    },
    users,
    devices,
    seen24h,
    seenPct,
    byBrand: byBrand.map((b) => ({ brand: b._id, devices: b.devices, seen24h: b.seen24h, seenPct: pct(b.seen24h, b.devices) })),
    byOsVersion: byOs.map((o) => ({ osVersion: o._id, devices: o.devices, seen24h: o.seen24h, seenPct: pct(o.seen24h, o.devices) })),
    statuses: Object.fromEntries(statuses.map((s) => [s._id, s.count])),
    permissionIssues: {
      locationNotAlways: issues.locationNotAlways ?? 0,
      batteryOptimized: issues.batteryOptimized ?? 0,
      notificationsOff: issues.notificationsOff ?? 0,
      remoteLockOff: issues.remoteLockOff ?? 0,
    },
    alerts7d: Object.fromEntries(alerts7d.map((a) => [a._id, a.count])),
    quietDevices: quiet.map((d) => ({
      id: String(d._id),
      brand: d.brand ?? null,
      model: d.model ?? null,
      osVersion: d.osVersion ?? null,
      appVersion: d.appVersion ?? null,
      lastSeenAt: d.lastSeenAt ?? null,
      locationAlways: d.permissions?.location === 'always',
      batteryOptimized: d.permissions?.batteryOptimized ?? null,
    })),
  });
});

export default router;
