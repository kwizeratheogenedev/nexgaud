import mongoose from 'mongoose';

const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
  { _id: false },
);

const deviceSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Organisation laptops: managed by every manager of the organisation, not only the person who enrolled them.
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Org', index: true },
    assignedTo: { type: String, trim: true, maxlength: 60 }, // e.g. "Computer lab, seat 12"
    hostname: { type: String, maxlength: 80 },
    // Family plan: the owner shares this device with their family (they can see, ring and locate it).
    familyShared: { type: Boolean, default: false },
    // Days of location history kept (30 unless the owner's plan gives more).
    historyDays: Number,
    name: { type: String, required: true, trim: true, maxlength: 60 },
    type: { type: String, enum: ['phone', 'laptop', 'tag'], default: 'phone' },
    platform: { type: String, enum: ['android', 'ios', 'windows', 'macos', 'linux'], default: 'android' },
    brand: String,
    model: String,
    osVersion: String,
    appVersion: String,
    status: { type: String, enum: ['normal', 'lost', 'stolen', 'recovered'], default: 'normal' },
    // Shown on the phone's screen while it is marked lost, so an honest finder can return it.
    lostMode: {
      message: { type: String, maxlength: 200 },
      contactPhone: { type: String, maxlength: 20 },
      since: Date,
    },

    // The phone authenticates with a long random token; only its HMAC is stored.
    tokenHash: { type: String, required: true, unique: true },
    pushToken: String,

    lastLocation: { type: pointSchema, default: undefined },
    lastLocationAt: Date,
    lastAccuracyM: Number,
    lastSeenAt: Date,
    battery: Number,
    charging: Boolean,
    network: String,
    simFingerprint: String,
    simChangedAt: Date,
    permissions: {
      location: String, // 'always' | 'while_in_use' | 'denied'
      notifications: Boolean,
      batteryOptimized: Boolean,
      deviceAdmin: Boolean,
    },
  },
  { timestamps: true },
);

deviceSchema.index({ lastLocation: '2dsphere' });

deviceSchema.methods.lostModePublic = function lostModePublic() {
  if (!['lost', 'stolen'].includes(this.status) || !this.lostMode?.since) return null;
  return {
    message: this.lostMode.message ?? null,
    contactPhone: this.lostMode.contactPhone ?? null,
    since: this.lostMode.since,
  };
};

deviceSchema.methods.toPublic = function toPublic() {
  const loc = this.lastLocation?.coordinates;
  return {
    id: this.id,
    name: this.name,
    type: this.type,
    platform: this.platform,
    ownerId: String(this.ownerId),
    orgId: this.orgId ? String(this.orgId) : null,
    familyShared: this.familyShared ?? false,
    historyDays: this.historyDays ?? 30,
    assignedTo: this.assignedTo ?? null,
    hostname: this.hostname ?? null,
    brand: this.brand ?? null,
    model: this.model ?? null,
    osVersion: this.osVersion ?? null,
    appVersion: this.appVersion ?? null,
    status: this.status,
    lostMode: this.lostModePublic(),
    simChangedAt: this.simChangedAt ?? null,
    lastLocation: loc ? { lat: loc[1], lng: loc[0], accuracyM: this.lastAccuracyM ?? null, at: this.lastLocationAt } : null,
    lastSeenAt: this.lastSeenAt ?? null,
    battery: this.battery ?? null,
    charging: this.charging ?? null,
    network: this.network ?? null,
    permissions: this.permissions ?? {},
    pushEnabled: Boolean(this.pushToken),
    createdAt: this.createdAt,
  };
};

export const Device = mongoose.model('Device', deviceSchema);
