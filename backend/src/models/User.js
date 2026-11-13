import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true }, // E.164
    name: { type: String, trim: true, maxlength: 80 },
    role: { type: String, enum: ['owner', 'shop', 'police', 'admin'], default: 'owner' },
    language: { type: String, enum: ['rw', 'en', 'fr'], default: 'en' },
    // Raising this signs the user out everywhere (refresh tokens carry it).
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    phone: this.phone,
    name: this.name ?? null,
    role: this.role,
    language: this.language,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
