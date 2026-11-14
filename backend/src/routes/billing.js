import express, { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { Invoice, Payment, PAYMENT_PROVIDERS } from '../models/Billing.js';
import { Org } from '../models/Org.js';
import { Device } from '../models/Device.js';
import { badRequest, notFound } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { objectId, validate } from '../lib/validate.js';
import { requireUser } from '../middleware/auth.js';
import { managedOrgIds } from '../services/access.js';
import { audit } from '../services/audit.js';
import { createInvoice, getProviders, refreshPayment, startPayment } from '../services/billing.js';
import { ALLOWED_MONTHS, familySubscription, GRACE_DAYS, orgSeats, prices } from '../services/plans.js';

/**
 * Plans and billing: buy the Family plan or laptop seats, pay invoices with MTN MoMo or Airtel Money.
 * Payment callbacks from the providers come in at /billing/callbacks/:provider?key=PAYMENT_CALLBACK_SECRET.
 */
const router = Router();

// ---- Provider callbacks (no sign-in). They only trigger a check with the provider: never trusted alone. ----

const digest = (v) => createHash('sha256').update(String(v ?? '')).digest();

router.post('/callbacks/:provider', express.json({ limit: '50kb' }), async (req, res) => {
  if (!config.paymentCallbackSecret || !timingSafeEqual(digest(req.query.key), digest(config.paymentCallbackSecret))) {
    return res.status(403).json({ error: 'forbidden', message: 'Not allowed' });
  }
  // MTN sends { externalId, ... }; Airtel sends { transaction: { id, ... } }. Both are our reference.
  const reference = req.body?.externalId ?? req.body?.transaction?.id ?? req.body?.referenceId;
  const payment = typeof reference === 'string' ? await Payment.findOne({ reference }) : null;
  if (payment) await refreshPayment(payment, { force: true }).catch((err) => logger.warn({ err: err.message }, 'Callback check failed'));
  res.status(200).json({ received: true });
});

router.use(requireUser);

const idParams = validate(z.object({ id: objectId }), 'params');
const DAY_MS = 86400 * 1000;

const planStatus = (sub) => {
  if (!sub) return { active: false, paidUntil: null, inGrace: false };
  const until = sub.paidUntil.getTime();
  return { active: until + GRACE_DAYS * DAY_MS > Date.now(), paidUntil: sub.paidUntil, inGrace: until < Date.now() && until + GRACE_DAYS * DAY_MS > Date.now() };
};

/** Invoices this user may see and pay: their own, and their organisations'. */
async function invoiceScope(user) {
  const orgIds = await managedOrgIds(user);
  return { $or: [{ subjectType: 'user', subjectId: user._id }, ...(orgIds.length ? [{ subjectType: 'org', subjectId: { $in: orgIds } }] : [])] };
}

async function scopedInvoice(req) {
  const invoice = await Invoice.findOne({ _id: req.valid.params.id, ...(await invoiceScope(req.user)) });
  if (!invoice) throw notFound('Invoice');
  return invoice;
}

router.get('/me', async (req, res) => {
  const orgIds = await managedOrgIds(req.user);
  const orgs = await Org.find({ _id: { $in: orgIds } }).select('name');
  res.json({
    prices: prices(),
    allowedMonths: ALLOWED_MONTHS,
    graceDays: GRACE_DAYS,
    providers: Object.keys(getProviders()),
    family: planStatus(await familySubscription(req.user._id)),
    orgs: await Promise.all(
      orgs.map(async (o) => ({ id: o.id, name: o.name, laptops: await Device.countDocuments({ orgId: o._id }), seats: await orgSeats(o._id) })),
    ),
  });
});

router.post(
  '/checkout',
  validate(
    z
      .object({
        plan: z.enum(['family', 'org_seats']),
        months: z.number().int().optional(),
        seats: z.number().int().min(1).max(500).optional(),
        addSeats: z.boolean().default(false),
        orgId: objectId.optional(),
        billTo: z.object({ name: z.string().trim().min(2).max(100), tin: z.string().trim().regex(/^\d{9}$/, 'A TIN has 9 digits').optional() }).optional(),
      })
      .refine((b) => b.addSeats || ALLOWED_MONTHS.includes(b.months), { message: `Choose ${ALLOWED_MONTHS.join(', ')} months`, path: ['months'] })
      .refine((b) => b.plan === 'family' || (b.orgId && b.seats), { message: 'Choose the organisation and the number of seats', path: ['seats'] }),
  ),
  async (req, res) => {
    const { plan, months, seats, addSeats, orgId, billTo } = req.valid.body;
    let subjectType = 'user';
    let subjectId = req.user._id;
    if (plan === 'org_seats') {
      const managed = await managedOrgIds(req.user);
      if (!managed.some((id) => String(id) === orgId)) throw notFound('Organisation');
      subjectType = 'org';
      subjectId = orgId;
    }
    const product = plan === 'family' ? { plan, months } : { plan, months: addSeats ? 0 : months, seats, addSeats };
    const invoice = await createInvoice({ user: req.user, product, subjectType, subjectId, billTo });
    res.status(201).json({ invoice: invoice.toPublic() });
  },
);

router.get('/invoices', async (req, res) => {
  const invoices = await Invoice.find(await invoiceScope(req.user)).sort({ createdAt: -1 }).limit(50);
  res.json({ invoices: invoices.map((i) => i.toPublic()) });
});

router.get('/invoices/:id', idParams, async (req, res) => {
  const invoice = await scopedInvoice(req);
  const payments = await Payment.find({ invoiceId: invoice._id }).sort({ createdAt: -1 }).limit(10);
  res.json({ invoice: invoice.toPublic(), payments: payments.map((p) => p.toPublic()) });
});

router.post(
  '/invoices/:id/pay',
  idParams,
  validate(z.object({ provider: z.enum(PAYMENT_PROVIDERS), phone: z.string().trim().min(5).max(20) })),
  async (req, res) => {
    const invoice = await scopedInvoice(req);
    const phone = normalizePhone(req.valid.body.phone);
    if (!phone) throw badRequest('phone_invalid', 'Enter a valid phone number');
    const payment = await startPayment({ user: req.user, invoice, providerName: req.valid.body.provider, phone });
    res.status(201).json({ payment: payment.toPublic() });
  },
);

// The billing page asks every few seconds while the person approves on their phone.
router.get('/payments/:id', idParams, async (req, res) => {
  const found = await Payment.findById(req.valid.params.id);
  const invoice = found && (await Invoice.findOne({ _id: found.invoiceId, ...(await invoiceScope(req.user)) }));
  if (!found || !invoice) throw notFound('Payment');
  const payment = await refreshPayment(found);
  res.json({ payment: payment.toPublic(), invoice: (await Invoice.findById(invoice._id)).toPublic() });
});

router.post('/invoices/:id/void', idParams, async (req, res) => {
  const invoice = await scopedInvoice(req);
  if (invoice.status !== 'open') throw badRequest('invoice_closed', 'Only an unpaid invoice can be cancelled');
  if (await Payment.exists({ invoiceId: invoice._id, status: 'pending' })) throw badRequest('payment_pending', 'A payment is waiting for approval');
  invoice.status = 'void';
  await invoice.save();
  await audit(req, 'invoice.voided', invoice, { number: invoice.number });
  res.json({ invoice: invoice.toPublic() });
});

export default router;
