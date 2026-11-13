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
    name: { type: String, required: true, trim: true, maxlength: 60 },
    type: { type: String, enum: ['phone', 'laptop', 'tag'], default: 'phone' },
    platform: { type: String, enum: ['android', 'ios', 'windows', 'macos', 'linux'], default: 'android' },
    brand: String,
    model: String,
    osVersion: String,
    appVersion: String,
    status: { type: String, enum: ['normal', 'lost', 'stolen', 'recovered'], default: 'normal' },

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

deviceSchema.methods.toPublic = function toPublic() {
  const loc = this.lastLocation?.coordinates;
  return {
    id: this.id,
    name: this.name,
    type: this.type,
    platform: this.platform,
    brand: this.brand ?? null,
    model: this.model ?? null,
    osVersion: this.osVersion ?? null,
    appVersion: this.appVersion ?? null,
    status: this.status,
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
