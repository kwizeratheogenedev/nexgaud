import mongoose from 'mongoose';

/**
 * Something the owner should know about one of their devices.
 * sim_changed / sim_removed: found by the API from the heartbeat's SIM fingerprint.
 * The others are reported by the phone itself (POST /device/events).
 */
export const ALERT_TYPES = [
  'sim_changed',
  'sim_removed',
  'protection_off',
  'admin_off',
  'pin_failed',
  'low_battery',
  'shutdown',
];
export const PHONE_EVENT_TYPES = ['protection_off', 'admin_off', 'pin_failed', 'low_battery', 'shutdown'];
export const ALERT_RETENTION_DAYS = 180;

const alertSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true },
    type: { type: String, enum: ALERT_TYPES, required: true },
    battery: Number,
    location: {
      lat: Number,
      lng: Number,
      accuracyM: Number,
      at: Date,
    },
    smsSent: { type: Boolean, default: false },
    readAt: Date,
  },
  { timestamps: true },
);

alertSchema.index({ ownerId: 1, createdAt: -1 });
alertSchema.index({ deviceId: 1, type: 1, createdAt: -1 });
alertSchema.index({ createdAt: 1 }, { expireAfterSeconds: ALERT_RETENTION_DAYS * 86400 });

alertSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    deviceId: String(this.deviceId),
    type: this.type,
    battery: this.battery ?? null,
    location: this.location?.lat != null ? this.location : null,
    smsSent: this.smsSent,
    read: Boolean(this.readAt),
    createdAt: this.createdAt,
  };
};

export const Alert = mongoose.model('Alert', alertSchema);
