import mongoose from 'mongoose';

export const LOCATION_RETENTION_DAYS = 30;

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
});

locationSchema.index({ deviceId: 1, recordedAt: -1 });
locationSchema.index({ point: '2dsphere' });
// History older than the retention window is deleted automatically.
locationSchema.index({ receivedAt: 1 }, { expireAfterSeconds: LOCATION_RETENTION_DAYS * 86400 });

export const Location = mongoose.model('Location', locationSchema);
