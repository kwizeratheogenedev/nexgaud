import mongoose from 'mongoose';

/**
 * A short-lived code that pairs a laptop agent (which has no browser sign-in) with an account
 * or an organisation. Shown once in the dashboard, typed into the agent, usable once.
 */
export const PAIRING_TTL_MS = 15 * 60 * 1000;

const pairingSchema = new mongoose.Schema(
  {
    codeHash: { type: String, required: true, unique: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Org' },
    name: { type: String, trim: true, maxlength: 60 },
    assignedTo: { type: String, trim: true, maxlength: 60 },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
    deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' },
  },
  { timestamps: true },
);

pairingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600 });

export const PairingCode = mongoose.model('PairingCode', pairingSchema);
