import mongoose from 'mongoose';

/**
 * A QR lost-and-found sticker. The QR holds only a link with the tag's code (…/t/K7M2PQ9X).
 * Whoever finds the item scans it, reads the owner's message and writes back through NexGuard;
 * neither side sees the other's phone number unless the finder chooses to share it.
 *
 * unclaimed: printed in a batch, not yet activated (needs the claim code printed beside it).
 * active: belongs to someone. lost: the owner marked the item lost (the finder page says so).
 */
export const TAG_STATUSES = ['unclaimed', 'active', 'lost', 'disabled'];
export const TAG_KINDS = ['keys', 'bag', 'wallet', 'laptop', 'phone', 'pet', 'other'];
export const MAX_TAGS_PER_USER = 50;
export const MAX_TAGS_PER_ORG = 2000;

const tagSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true }, // 8 characters, no look-alikes
    status: { type: String, enum: TAG_STATUSES, default: 'unclaimed' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Org', index: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'TagBatch', index: true },
    // Printed beside the QR code on batch sheets; kept only until the tag is claimed.
    claimCode: String,
    claimAttempts: { type: Number, default: 0 },
    name: { type: String, trim: true, maxlength: 40 },
    kind: { type: String, enum: TAG_KINDS, default: 'other' },
    message: { type: String, trim: true, maxlength: 300 }, // shown to the finder
    claimedAt: Date,
    lostSince: Date,
    scans: { type: Number, default: 0 },
    lastScanAt: Date,
  },
  { timestamps: true },
);

tagSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    code: this.code,
    status: this.status,
    orgId: this.orgId ? String(this.orgId) : null,
    name: this.name ?? null,
    kind: this.kind,
    message: this.message ?? null,
    claimedAt: this.claimedAt ?? null,
    lostSince: this.lostSince ?? null,
    scans: this.scans,
    lastScanAt: this.lastScanAt ?? null,
    createdAt: this.createdAt,
  };
};

export const Tag = mongoose.model('Tag', tagSchema);
