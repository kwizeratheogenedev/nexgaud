import mongoose from 'mongoose';

/**
 * A conversation between a finder and the tag's owner, relayed by NexGuard.
 * The finder holds a secret link (only its hash is stored); their phone number, if given,
 * is used only to text them the owner's replies, and shown to the owner only if they agree.
 */
export const MAX_THREAD_MESSAGES = 50;
export const THREAD_RETENTION_DAYS = 180;

const messageSchema = new mongoose.Schema(
  {
    from: { type: String, enum: ['finder', 'owner'], required: true },
    text: { type: String, trim: true, maxlength: 500, required: true },
    location: { lat: Number, lng: Number, accuracyM: Number },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // the owner or organisation manager who replied
    at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const threadSchema = new mongoose.Schema(
  {
    tagId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tag', required: true, index: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Org' },
    finderTokenHash: { type: String, required: true, unique: true },
    finderPhone: String,
    shareFinderPhone: { type: Boolean, default: false },
    finderLanguage: { type: String, enum: ['rw', 'en', 'fr'], default: 'en' },
    messages: { type: [messageSchema], default: [] },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    lastMessageAt: { type: Date, default: Date.now },
    ownerReadAt: Date,
  },
  { timestamps: true },
);

threadSchema.index({ ownerId: 1, lastMessageAt: -1 });
threadSchema.index({ orgId: 1, lastMessageAt: -1 });
threadSchema.index({ lastMessageAt: 1 }, { expireAfterSeconds: THREAD_RETENTION_DAYS * 86400 });

/** What the owner sees. */
threadSchema.methods.toOwner = function toOwner() {
  return {
    id: this.id,
    tagId: String(this.tagId),
    status: this.status,
    finderPhone: this.shareFinderPhone ? (this.finderPhone ?? null) : null,
    finderReachableBySms: Boolean(this.finderPhone),
    messages: this.messages.map((m) => ({ id: m.id, from: m.from, text: m.text, location: m.location?.lat != null ? m.location : null, at: m.at })),
    unread: !this.ownerReadAt || this.ownerReadAt < this.lastMessageAt,
    lastMessageAt: this.lastMessageAt,
    createdAt: this.createdAt,
  };
};

/** What the finder sees: the messages, nothing about the owner. */
threadSchema.methods.toFinder = function toFinder() {
  return {
    status: this.status,
    messages: this.messages.map((m) => ({ from: m.from, text: m.text, at: m.at })),
  };
};

export const TagThread = mongoose.model('TagThread', threadSchema);
