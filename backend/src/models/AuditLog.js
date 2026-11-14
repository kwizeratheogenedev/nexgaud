import mongoose from 'mongoose';

/**
 * Who did what in the registry: reports, reviews, disputes, transfers, partner and key changes.
 * Kept without an expiry: the team must be able to explain every decision later.
 */
const auditSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorRole: String, // owner | shop | police | admin | partner_api
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
    action: { type: String, required: true },
    targetType: String,
    targetId: mongoose.Schema.Types.ObjectId,
    details: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

auditSchema.index({ createdAt: -1 });
auditSchema.index({ action: 1, createdAt: -1 });
auditSchema.index({ targetId: 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditSchema);
