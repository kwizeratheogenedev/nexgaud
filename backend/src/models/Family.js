import mongoose from 'mongoose';

/**
 * Family sharing (Family plan): the owner adds up to 5 people. Each person chooses which of their own
 * phones to share (Device.familyShared); the others can then see, ring and locate those phones.
 * A person belongs to at most one family.
 */
export const MAX_FAMILY_MEMBERS = 5; // besides the owner

const familySchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    name: { type: String, trim: true, maxlength: 60 },
    members: [
      {
        _id: false,
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        addedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

familySchema.index({ 'members.userId': 1 });

/** Everyone in the family, owner first. */
familySchema.methods.everyone = function everyone() {
  return [this.ownerId, ...this.members.map((m) => m.userId)];
};

export const Family = mongoose.model('Family', familySchema);
