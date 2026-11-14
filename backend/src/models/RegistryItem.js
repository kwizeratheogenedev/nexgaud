import mongoose from 'mongoose';

/**
 * A device in the stolen-device registry: who owns which IMEI or serial number.
 * Separate from Device (a phone running the NexGuard app): laptops and phones without the app
 * can be registered too, and a registered phone can be linked to its tracked Device.
 */
export const ITEM_KINDS = ['phone', 'tablet', 'laptop', 'other'];
// registered: nothing reported. stolen / lost: an approved report is open (shown by the public check).
export const ITEM_STATUSES = ['registered', 'stolen', 'lost'];
export const PROOF_KINDS = ['box', 'receipt', 'other'];
export const PROOF_STATUSES = ['none', 'submitted', 'accepted', 'rejected'];
export const MAX_PROOFS = 4;
export const MAX_ITEMS_PER_USER = 20;

const proofSchema = new mongoose.Schema({
  uploadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Upload', required: true },
  kind: { type: String, enum: PROOF_KINDS, default: 'other' },
  mime: String,
  size: Number,
  addedAt: { type: Date, default: Date.now },
});

const itemSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ITEM_KINDS, default: 'phone' },
    brand: { type: String, trim: true, maxlength: 40, required: true },
    model: { type: String, trim: true, maxlength: 60 },
    color: { type: String, trim: true, maxlength: 30 },
    // Up to two IMEIs (dual-SIM phones have two). Unique across the registry.
    imeis: { type: [String], default: undefined },
    serial: String, // normalised: upper case, letters and digits only
    brandKey: String, // lower-case brand, so two brands may use the same serial
    deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' }, // the tracked phone, if any
    status: { type: String, enum: ITEM_STATUSES, default: 'registered' },
    proofs: { type: [proofSchema], default: [] },
    proofStatus: { type: String, enum: PROOF_STATUSES, default: 'none' },
    // Selling the device: the owner makes a code, the buyer claims the device with it.
    transfer: {
      codeHash: String,
      expiresAt: Date,
      attempts: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

itemSchema.index({ imeis: 1 }, { unique: true, partialFilterExpression: { imeis: { $type: 'string' } } });
itemSchema.index({ serial: 1, brandKey: 1 }, { unique: true, partialFilterExpression: { serial: { $type: 'string' } } });
itemSchema.index({ status: 1 });

itemSchema.methods.label = function label() {
  return [this.brand, this.model].filter(Boolean).join(' ');
};

itemSchema.methods.transferOpen = function transferOpen() {
  return Boolean(this.transfer?.codeHash && this.transfer.expiresAt > new Date());
};

/** What the owner (and admins) see. */
itemSchema.methods.toPublic = function toPublic() {
  const open = this.transferOpen();
  return {
    id: this.id,
    kind: this.kind,
    brand: this.brand,
    model: this.model ?? null,
    color: this.color ?? null,
    imeis: this.imeis ?? [],
    serial: this.serial ?? null,
    deviceId: this.deviceId ? String(this.deviceId) : null,
    status: this.status,
    proofs: this.proofs.map((p) => ({ id: p.id, uploadId: String(p.uploadId), kind: p.kind, mime: p.mime, size: p.size, addedAt: p.addedAt })),
    proofStatus: this.proofStatus,
    transferExpiresAt: open ? this.transfer.expiresAt : null,
    createdAt: this.createdAt,
  };
};

export const RegistryItem = mongoose.model('RegistryItem', itemSchema);
