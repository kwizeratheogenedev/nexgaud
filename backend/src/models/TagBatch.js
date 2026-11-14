import mongoose from 'mongoose';

/** A print run of unclaimed tags, made by the NexGuard team (for shops, schools, events). */
export const MAX_BATCH_SIZE = 500;

const batchSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 80, required: true },
    count: { type: Number, required: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' }, // the shop selling them, if any
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const TagBatch = mongoose.model('TagBatch', batchSchema);
