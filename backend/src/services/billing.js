import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { Invoice, Payment, nextInvoiceNumber } from '../models/Billing.js';
import { badRequest, HttpError } from '../lib/errors.js';
import { maskPhone } from '../lib/phone.js';
import { availableProviders, networkOf } from './paymentProviders.js';
import { applyPurchase, daysLeft, familySubscription, orgSeats, prices, roundPrice } from './plans.js';
import { audit } from './audit.js';

// A payment the person has not approved within 15 minutes is given up.
export const PAYMENT_EXPIRY_MS = 15 * 60 * 1000;
// Ask the provider at most this often about one payment.
const MIN_CHECK_GAP_MS = 4000;

let providers = null;
/** Providers can be replaced in tests (to point MTN or Airtel at a fake server). */
export function setProviders(list) {
  providers = list;
}
export const getProviders = () => (providers ??= availableProviders());

const monthsLabel = (m) => `${m} month${m === 1 ? '' : 's'}`;

/** Builds the invoice for a purchase. Prices come from the server's settings, never from the browser. */
export async function createInvoice({ user, product, subjectType, subjectId, billTo }) {
  const p = prices();
  let lines;
  if (product.plan === 'family') {
    lines = [{ description: `NexGuard Family plan, ${monthsLabel(product.months)}`, quantity: product.months, unitPrice: p.family }];
  } else if (product.addSeats) {
    const seats = await orgSeats(subjectId);
    if (!seats.active || !seats.paidUntil || seats.paidUntil < new Date()) {
      throw badRequest('no_active_seats', 'Buy seats for a number of months first');
    }
    const days = daysLeft(seats.paidUntil);
    const unitPrice = roundPrice((p.laptopSeat * days) / 30);
    lines = [{ description: `Extra laptop seat until ${seats.paidUntil.toISOString().slice(0, 10)} (${days} days)`, quantity: product.seats, unitPrice }];
  } else {
    lines = [
      {
        description: `NexGuard laptop seats (beyond the ${p.orgFreeLaptops} free), ${monthsLabel(product.months)}`,
        quantity: product.seats * product.months,
        unitPrice: p.laptopSeat,
      },
    ];
  }
  lines = lines.map((l) => ({ ...l, amount: l.quantity * l.unitPrice }));
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  if (total <= 0) throw badRequest('free', 'Nothing to pay');
  const invoice = await Invoice.create({
    number: await nextInvoiceNumber(),
    subjectType,
    subjectId,
    createdBy: user._id,
    product,
    billTo,
    lines,
    total,
  });
  await audit({ user }, 'invoice.created', invoice, { number: invoice.number, total });
  return invoice;
}

const callbackUrl = (provider) =>
  config.PUBLIC_API_URL && config.paymentCallbackSecret
    ? `${config.PUBLIC_API_URL.replace(/\/+$/, '')}/api/v1/billing/callbacks/${provider}?key=${encodeURIComponent(config.paymentCallbackSecret)}`
    : undefined;

/** Asks the provider to charge the phone. The person then approves on their phone. */
export async function startPayment({ user, invoice, providerName, phone }) {
  if (invoice.status !== 'open') throw badRequest('invoice_closed', 'This invoice is already paid or cancelled');
  const provider = getProviders()[providerName];
  if (!provider) throw badRequest('provider_unavailable', 'This payment method is not available');
  const network = networkOf(phone);
  if (providerName !== 'fake' && network && network !== providerName) {
    throw badRequest('wrong_network', providerName === 'mtn_momo' ? 'This is not an MTN number (078 or 079)' : 'This is not an Airtel number (072 or 073)');
  }
  if (await Payment.exists({ invoiceId: invoice._id, status: 'pending', createdAt: { $gt: new Date(Date.now() - PAYMENT_EXPIRY_MS) } })) {
    throw new HttpError(409, 'payment_pending', 'A payment for this invoice is waiting for approval on a phone');
  }

  const payment = await Payment.create({
    invoiceId: invoice._id,
    userId: user._id,
    provider: providerName,
    payerPhone: phone,
    amount: invoice.total,
    currency: provider.currency,
    reference: randomUUID(),
  });
  try {
    await provider.request({
      reference: payment.reference,
      amount: payment.amount,
      currency: payment.currency,
      phone,
      description: `NexGuard invoice ${invoice.number}`,
      callbackUrl: callbackUrl(providerName),
    });
  } catch (err) {
    payment.status = 'failed';
    payment.failureReason = err.message.slice(0, 200);
    await payment.save();
    logger.warn({ err: err.message, provider: providerName, to: maskPhone(phone) }, 'Payment request refused');
    throw new HttpError(400, 'payment_refused', 'The mobile money service refused the payment. Check the number and try again.');
  }
  await audit({ user }, 'payment.started', payment, { invoice: invoice.number, provider: providerName, amount: payment.amount });
  return payment;
}

/**
 * Asks the provider how a pending payment is going, and settles it when it is done.
 * Safe to call any number of times, from the browser, a callback or the background check:
 * the invoice is applied exactly once.
 */
export async function refreshPayment(payment, { force = false } = {}) {
  if (payment.status !== 'pending') return payment;
  if (Date.now() - payment.createdAt.getTime() > PAYMENT_EXPIRY_MS) {
    await Payment.updateOne({ _id: payment._id, status: 'pending' }, { status: 'expired', failureReason: 'Not approved in time' });
    return Payment.findById(payment._id);
  }
  if (!force && payment.lastCheckedAt && Date.now() - payment.lastCheckedAt.getTime() < MIN_CHECK_GAP_MS) return payment;

  const provider = getProviders()[payment.provider];
  if (!provider) return payment;
  let result;
  try {
    result = await provider.status({ reference: payment.reference, phone: payment.payerPhone });
  } catch (err) {
    logger.warn({ err: err.message, provider: payment.provider }, 'Payment status check failed');
    await Payment.updateOne({ _id: payment._id }, { lastCheckedAt: new Date(), $inc: { checks: 1 } });
    return Payment.findById(payment._id);
  }
  await Payment.updateOne({ _id: payment._id }, { lastCheckedAt: new Date(), $inc: { checks: 1 } });
  if (result.status === 'pending') return Payment.findById(payment._id);

  // The provider must have charged what the invoice says.
  if (result.status === 'successful' && result.amount != null && Number(result.amount) !== payment.amount) {
    logger.error({ expected: payment.amount, got: result.amount, reference: payment.reference }, 'Payment amount does not match the invoice');
    result = { status: 'failed', reason: 'Amount does not match the invoice' };
  }

  // Only one caller wins this update, so the invoice is applied once.
  const settled = await Payment.findOneAndUpdate(
    { _id: payment._id, status: 'pending' },
    {
      status: result.status,
      providerTxnId: result.providerTxnId,
      failureReason: result.status === 'failed' ? (result.reason ?? 'Declined').slice(0, 200) : undefined,
      settledAt: new Date(),
    },
    { new: true },
  );
  if (!settled) return Payment.findById(payment._id);

  if (settled.status === 'successful') {
    const invoice = await Invoice.findOneAndUpdate({ _id: settled.invoiceId, status: 'open' }, { status: 'paid', paidAt: new Date(), paymentId: settled._id }, { new: true });
    if (invoice) {
      await applyPurchase(invoice);
      await audit({ user: { _id: settled.userId } }, 'invoice.paid', invoice, { number: invoice.number, provider: settled.provider, total: invoice.total });
    } else {
      // Paid twice (two phones approved): keep a trace so the team can refund by hand.
      logger.error({ payment: settled.id }, 'Payment succeeded for an invoice that was already paid');
      await audit({ user: { _id: settled.userId } }, 'payment.duplicate', settled, { reference: settled.reference });
    }
  }
  return settled;
}

/** Every 30 seconds: check pending payments (callbacks can be lost), and once an hour end lapsed plans. */
export function startBillingJobs({ expireLapsedPlans }) {
  const checkPending = async () => {
    const pending = await Payment.find({ status: 'pending', createdAt: { $lt: new Date(Date.now() - 20000) } }).limit(50);
    for (const p of pending) await refreshPayment(p).catch((err) => logger.warn({ err: err.message }, 'Pending payment check failed'));
  };
  const a = setInterval(() => checkPending().catch(() => {}), 30000);
  const b = setInterval(() => expireLapsedPlans().catch((err) => logger.warn({ err: err.message }, 'Plan expiry failed')), 3600 * 1000);
  a.unref();
  b.unref();
  return () => {
    clearInterval(a);
    clearInterval(b);
  };
}

/** The user's plan, for the billing page. */
export async function familyStatus(userId) {
  const sub = await familySubscription(userId);
  return { paidUntil: sub?.paidUntil ?? null };
}
