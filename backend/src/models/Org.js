import mongoose from 'mongoose';

/**
 * A school, company or NGO that manages its own laptops and tags. Every member is a manager:
 * they see the organisation's devices and tags, never the members' personal ones.
 * Organisation laptops are enrolled with an organisation pairing code and say so on screen.
 */
export const ORG_TYPES = ['school', 'company', 'ngo', 'other'];
export const MAX_ORG_MEMBERS = 50;
export const MAX_ORG_DEVICES = 500;

const orgSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 80, required: true },
    type: { type: String, enum: ORG_TYPES, default: 'school' },
    district: { type: String, trim: true, maxlength: 40 },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    members: [
      {
        _id: false,
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        addedAt: { type: Date, default: Date.now },
      },
    ],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

orgSchema.index({ 'members.userId': 1 });

orgSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    name: this.name,
    type: this.type,
    district: this.district ?? null,
    status: this.status,
    createdAt: this.createdAt,
  };
};

export const Org = mongoose.model('Org', orgSchema);
