import { Router } from 'express';
import { z } from 'zod';
import { Alert } from '../models/Alert.js';
import { objectId, validate } from '../lib/validate.js';
import { requireUser } from '../middleware/auth.js';

// The owner's alerts across all their devices (SIM changed, protection off, low battery...).
const router = Router();
router.use(requireUser);

router.get(
  '/',
  validate(
    z.object({
      deviceId: objectId.optional(),
      unread: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
    'query',
  ),
  async (req, res) => {
    const { deviceId, unread, limit } = req.valid.query;
    const filter = { ownerId: req.user._id };
    if (deviceId) filter.deviceId = deviceId;
    if (unread === 'true') filter.readAt = null;

    const [alerts, unreadCount] = await Promise.all([
      Alert.find(filter).sort({ createdAt: -1 }).limit(limit),
      Alert.countDocuments({ ownerId: req.user._id, readAt: null }),
    ]);
    res.json({ alerts: alerts.map((a) => a.toPublic()), unread: unreadCount });
  },
);

// Marks the given alerts as read, or all of them when no ids are sent.
router.post('/read', validate(z.object({ ids: z.array(objectId).max(100).optional() })), async (req, res) => {
  const filter = { ownerId: req.user._id, readAt: null };
  if (req.valid.body.ids) filter._id = { $in: req.valid.body.ids };
  const result = await Alert.updateMany(filter, { readAt: new Date() });
  res.json({ updated: result.modifiedCount });
});

export default router;
