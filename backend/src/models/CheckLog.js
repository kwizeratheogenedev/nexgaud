import mongoose from 'mongoose';

/**
 * One registry check (public web page, USSD, SMS, partner portal or API).
 * Used for statistics, the partner gate, and to tell owners when their stolen phone is checked.
 * The person checking is not stored: only a keyed hash of their IP or phone number, for rate limits.
 */
export const CHECK_SOURCES = ['web', 'ussd', 'sms', 'partner_portal', 'partner_api'];
export const CHECK_RESULTS = ['stolen', 'lost', 'registered', 'not_registered', 'invalid'];
export const CHECK_RETENTION_DAYS = 365;

const checkSchema = new mongoose.Schema(
  {
    source: { type: String, enum: CHECK_SOURCES, required: true },
    queryKind: { type: String, enum: ['imei', 'serial', 'invalid'], required: true },
    result: { type: String, enum: CHECK_RESULTS, required: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'RegistryItem' },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requesterHash: String,
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

checkSchema.index({ createdAt: 1 }, { expireAfterSeconds: CHECK_RETENTION_DAYS * 86400 });
checkSchema.index({ partnerId: 1, createdAt: -1 });
checkSchema.index({ itemId: 1, createdAt: -1 });

export const CheckLog = mongoose.model('CheckLog', checkSchema);
