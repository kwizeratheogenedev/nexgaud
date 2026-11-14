import mongoose from 'mongoose';

/**
 * Plans, invoices and payments.
 *
 * Subscription: what a person (Family plan) or an organisation (laptop seats) has paid for, until when.
 * Paying again extends paidUntil; nothing renews by itself (mobile money has no stored cards).
 *
 * Invoice: every purchase. open → paid (or void). Numbered NG-<year>-<6 digits> for the organisation's books.
 *
 * Payment: one try to pay an invoice with mobile money. pending → successful | failed | expired.
 * A payment is only marked successful after NexGuard asked the provider itself, never on a callback alone.
 */
export const PLANS = ['family', 'org_seats'];
export const PAYMENT_PROVIDERS = ['mtn_momo', 'airtel_money', 'fake'];
export const PAYMENT_STATUSES = ['pending', 'successful', 'failed', 'expired'];

const subscriptionSchema = new mongoose.Schema(
  {
    subjectType: { type: String, enum: ['user', 'org'], required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, required: true },
    plan: { type: String, enum: PLANS, required: true },
    seats: { type: Number, default: 0 }, // laptop seats bought (org_seats)
    paidUntil: { type: Date, required: true },
  },
  { timestamps: true },
);
subscriptionSchema.index({ subjectType: 1, subjectId: 1, plan: 1 }, { unique: true });

const lineSchema = new mongoose.Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    amount: { type: Number, required: true },
  },
  { _id: false },
);

const invoiceSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    subjectType: { type: String, enum: ['user', 'org'], required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // What is being bought, applied when the invoice is paid.
    product: {
      plan: { type: String, enum: PLANS, required: true },
      months: { type: Number, required: true },
      seats: Number,
      addSeats: Boolean, // extra seats until the current end date, priced for the days left
    },
    billTo: { name: String, tin: String }, // the organisation's name and tax number (TIN), if it wants them on the invoice
    lines: { type: [lineSchema], required: true },
    total: { type: Number, required: true },
    currency: { type: String, default: 'RWF' },
    status: { type: String, enum: ['open', 'paid', 'void'], default: 'open' },
    paidAt: Date,
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
  },
  { timestamps: true },
);

invoiceSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    number: this.number,
    subjectType: this.subjectType,
    subjectId: String(this.subjectId),
    product: { plan: this.product.plan, months: this.product.months, seats: this.product.seats ?? null, addSeats: Boolean(this.product.addSeats) },
    billTo: this.billTo?.name ? { name: this.billTo.name, tin: this.billTo.tin ?? null } : null,
    lines: this.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount })),
    total: this.total,
    currency: this.currency,
    status: this.status,
    paidAt: this.paidAt ?? null,
    createdAt: this.createdAt,
  };
};

const paymentSchema = new mongoose.Schema(
  {
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: PAYMENT_PROVIDERS, required: true },
    payerPhone: { type: String, required: true }, // E.164
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    reference: { type: String, required: true, unique: true }, // our id, sent to the provider (a UUID)
    providerTxnId: String,
    status: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
    failureReason: String,
    checks: { type: Number, default: 0 },
    lastCheckedAt: Date,
    settledAt: Date,
  },
  { timestamps: true },
);
paymentSchema.index({ status: 1, createdAt: 1 });

paymentSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    invoiceId: String(this.invoiceId),
    provider: this.provider,
    payerPhone: this.payerPhone,
    amount: this.amount,
    currency: this.currency,
    status: this.status,
    failureReason: this.failureReason ?? null,
    createdAt: this.createdAt,
    settledAt: this.settledAt ?? null,
  };
};

// Invoice numbers: one counter per year.
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });

export const Subscription = mongoose.model('Subscription', subscriptionSchema);
export const Invoice = mongoose.model('Invoice', invoiceSchema);
export const Payment = mongoose.model('Payment', paymentSchema);
export const Counter = mongoose.model('Counter', counterSchema);

export async function nextInvoiceNumber(date = new Date()) {
  const year = date.getUTCFullYear();
  const counter = await Counter.findOneAndUpdate({ _id: `invoice-${year}` }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `NG-${year}-${String(counter.seq).padStart(6, '0')}`;
}
