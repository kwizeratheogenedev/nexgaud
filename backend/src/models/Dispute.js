import mongoose from 'mongoose';

/**
 * Someone disagrees with the registry: "this IMEI is mine" (ownership),
 * or "I bought this phone legally and it shows as stolen" (report). The team decides.
 */
export const DISPUTE_REASONS = ['ownership', 'report'];
export const DISPUTE_STATUSES = ['open', 'upheld', 'rejected'];
// What an upheld dispute does: nothing more, close the stolen report, or give the device to the claimant.
export const DISPUTE_ACTIONS = ['none', 'close_report', 'transfer_item'];

const disputeSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'RegistryItem', required: true, index: true },
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reason: { type: String, enum: DISPUTE_REASONS, required: true },
    message: { type: String, trim: true, maxlength: 1000, required: true },
    evidence: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Upload' }],
    status: { type: String, enum: DISPUTE_STATUSES, default: 'open' },
    action: { type: String, enum: DISPUTE_ACTIONS },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    resolution: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

disputeSchema.index({ status: 1, createdAt: 1 });

disputeSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    itemId: String(this.itemId),
    reason: this.reason,
    message: this.message,
    evidence: (this.evidence ?? []).map(String),
    status: this.status,
    action: this.action ?? null,
    resolvedAt: this.resolvedAt ?? null,
    resolution: this.resolution ?? null,
    createdAt: this.createdAt,
  };
};

export const Dispute = mongoose.model('Dispute', disputeSchema);
