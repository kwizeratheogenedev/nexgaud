import mongoose from 'mongoose';

/**
 * The owner reports a registered device stolen or lost. The NexGuard team checks it
 * (police case number, proof of ownership) before the public check shows it.
 * pending → approved → closed (recovered, withdrawn...), or pending → rejected.
 */
export const REPORT_TYPES = ['stolen', 'lost'];
export const REPORT_STATUSES = ['pending', 'approved', 'rejected', 'closed'];
export const CLOSE_REASONS = ['recovered', 'withdrawn', 'dispute', 'transferred'];

const reportSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'RegistryItem', required: true, index: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: REPORT_TYPES, required: true },
    incidentAt: { type: Date, required: true },
    place: { type: String, trim: true, maxlength: 120, required: true },
    description: { type: String, trim: true, maxlength: 1000 },
    policeCaseNumber: { type: String, trim: true, maxlength: 40 },
    policeStation: { type: String, trim: true, maxlength: 80 },
    status: { type: String, enum: REPORT_STATUSES, default: 'pending' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    reviewNote: { type: String, trim: true, maxlength: 500 },
    closedAt: Date,
    closedReason: { type: String, enum: CLOSE_REASONS },
  },
  { timestamps: true },
);

reportSchema.index({ status: 1, createdAt: 1 });

export const isOpenReport = (r) => r && ['pending', 'approved'].includes(r.status);

reportSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    itemId: String(this.itemId),
    type: this.type,
    incidentAt: this.incidentAt,
    place: this.place,
    description: this.description ?? null,
    policeCaseNumber: this.policeCaseNumber ?? null,
    policeStation: this.policeStation ?? null,
    status: this.status,
    reviewedAt: this.reviewedAt ?? null,
    reviewNote: this.reviewNote ?? null,
    closedAt: this.closedAt ?? null,
    closedReason: this.closedReason ?? null,
    createdAt: this.createdAt,
  };
};

export const TheftReport = mongoose.model('TheftReport', reportSchema);
