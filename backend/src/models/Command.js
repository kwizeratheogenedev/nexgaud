import mongoose from 'mongoose';

export const COMMAND_TYPES = ['ring', 'lock', 'locate', 'message'];
export const COMMAND_TTL_MS = 24 * 3600 * 1000;

const commandSchema = new mongoose.Schema(
  {
    deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true },
    type: { type: String, enum: COMMAND_TYPES, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    // queued → sent (phone fetched it) → done | failed; expired if the phone never answers.
    status: { type: String, enum: ['queued', 'sent', 'done', 'failed', 'expired'], default: 'queued' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pushed: { type: Boolean, default: false },
    sentAt: Date,
    completedAt: Date,
    result: String,
    expiresAt: { type: Date, default: () => new Date(Date.now() + COMMAND_TTL_MS) },
  },
  { timestamps: true },
);

commandSchema.index({ deviceId: 1, createdAt: -1 });
commandSchema.index({ deviceId: 1, status: 1 });

commandSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    deviceId: String(this.deviceId),
    type: this.type,
    payload: this.payload ?? {},
    status: this.status,
    pushed: this.pushed,
    result: this.result ?? null,
    createdAt: this.createdAt,
    sentAt: this.sentAt ?? null,
    completedAt: this.completedAt ?? null,
    expiresAt: this.expiresAt,
  };
};

export const Command = mongoose.model('Command', commandSchema);
