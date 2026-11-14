import mongoose from 'mongoose';

/**
 * A business that checks phones before buying, repairing or selling them (phone shops, repairers),
 * or the police. Its members (users with partnerId) use the partner portal; its systems use API keys.
 */
export const PARTNER_TYPES = ['shop', 'repair', 'police', 'other'];
export const MAX_API_KEYS = 5;

const apiKeySchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 40, required: true },
    prefix: { type: String, required: true }, // the visible start of the key, to tell keys apart
    hash: { type: String, required: true }, // HMAC of the whole key; the key itself is shown once
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastUsedAt: Date,
    revokedAt: Date,
  },
  { timestamps: true },
);

const partnerSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 80, required: true },
    type: { type: String, enum: PARTNER_TYPES, default: 'shop' },
    district: { type: String, trim: true, maxlength: 40 },
    contactPhone: String,
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    apiKeys: { type: [apiKeySchema], default: [] },
  },
  { timestamps: true },
);

partnerSchema.index({ 'apiKeys.hash': 1 });

partnerSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    name: this.name,
    type: this.type,
    district: this.district ?? null,
    contactPhone: this.contactPhone ?? null,
    status: this.status,
    apiKeys: this.apiKeys
      .filter((k) => !k.revokedAt)
      .map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt ?? null })),
    createdAt: this.createdAt,
  };
};

export const Partner = mongoose.model('Partner', partnerSchema);
