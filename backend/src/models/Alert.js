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
  // Stolen-device registry (itemId instead of deviceId).
  'registry_check',
  'registry_tip',
  'report_approved',
  'report_rejected',
  'dispute_opened',
  'dispute_resolved',
  'item_transferred',
  // QR tags (tagId instead of deviceId).
  'tag_scanned',
  'tag_message',
];
export const PHONE_EVENT_TYPES = ['protection_off', 'admin_off', 'pin_failed', 'low_battery', 'shutdown'];
export const ALERT_RETENTION_DAYS = 180;

const alertSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'RegistryItem' },
    tagId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tag' },
    threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'TagThread' },
    // Registry alerts: who checked the device (a partner's name, or "USSD"), and a finder's message.
    source: { type: String, maxlength: 80 },
    message: { type: String, maxlength: 500 },
    contactPhone: { type: String, maxlength: 20 },
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
    deviceId: this.deviceId ? String(this.deviceId) : null,
    itemId: this.itemId ? String(this.itemId) : null,
    tagId: this.tagId ? String(this.tagId) : null,
    threadId: this.threadId ? String(this.threadId) : null,
    source: this.source ?? null,
    message: this.message ?? null,
    contactPhone: this.contactPhone ?? null,
    type: this.type,
    battery: this.battery ?? null,
    location: this.location?.lat != null ? this.location : null,
    smsSent: this.smsSent,
    read: Boolean(this.readAt),
    createdAt: this.createdAt,
  };
};

export const Alert = mongoose.model('Alert', alertSchema);
