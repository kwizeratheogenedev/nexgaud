import mongoose from 'mongoose';

export const LOCATION_RETENTION_DAYS = 30;
// While a device is marked lost or stolen, its history is kept longer (police cases take time).
export const LOST_RETENTION_DAYS = 365;
const DAY_MS = 86400 * 1000;

const locationSchema = new mongoose.Schema({
  deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true },
  point: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
  accuracyM: Number,
  source: { type: String, enum: ['gps', 'network', 'fused', 'wifi', 'unknown'], default: 'unknown' },
  battery: Number,
  recordedAt: { type: Date, required: true },
  receivedAt: { type: Date, default: Date.now },
  // Deleted automatically at this time.
  expiresAt: { type: Date, required: true },
});

locationSchema.index({ deviceId: 1, recordedAt: -1 });
locationSchema.index({ point: '2dsphere' });
locationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const isLostStatus = (status) => ['lost', 'stolen'].includes(status);

// Lost devices keep a year; otherwise what the owner's plan gives (30 days, or 90 with the Family plan).
const retentionDays = (device) => (isLostStatus(device.status) ? LOST_RETENTION_DAYS : (device.historyDays ?? LOCATION_RETENTION_DAYS));

/** When a point received now for this device should be deleted. */
export function locationExpiry(device, from = Date.now()) {
  return new Date(from + retentionDays(device) * DAY_MS);
}

/** Re-applies the retention rule to a device's whole history after its status changes. */
export async function updateRetention(device) {
  await Location.updateMany(
    { deviceId: device._id },
    [{ $set: { expiresAt: { $add: ['$receivedAt', retentionDays(device) * DAY_MS] } } }],
    { updatePipeline: true },
  );
}

export const Location = mongoose.model('Location', locationSchema);
