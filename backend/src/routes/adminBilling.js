import { Router } from 'express';
import { config } from '../config.js';
import { Invoice, Payment, Subscription } from '../models/Billing.js';
import { User } from '../models/User.js';
import { requireRole, requireUser } from '../middleware/auth.js';
import { GRACE_DAYS, prices } from '../services/plans.js';

/** The NexGuard team: revenue, plans and the Phase 5 gate (paying customers cover server costs). Mounted under /admin. */
const router = Router();
router.use(requireUser, requireRole('admin'));

const DAY_MS = 86400 * 1000;

router.get('/billing/stats', async (_req, res) => {
  const monthAgo = new Date(Date.now() - 30 * DAY_MS);
  const activeSince = new Date(Date.now() - GRACE_DAYS * DAY_MS);
  const [revenue, byStatus, byProvider, family, seats, payments, openInvoices, real] = await Promise.all([
    Payment.aggregate([{ $match: { status: 'successful', settledAt: { $gte: monthAgo } } }, { $group: { _id: '$currency', total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { createdAt: { $gte: monthAgo } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { status: 'successful', settledAt: { $gte: monthAgo } } }, { $group: { _id: '$provider', total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    Subscription.countDocuments({ plan: 'family', paidUntil: { $gte: activeSince } }),
    Subscription.aggregate([{ $match: { plan: 'org_seats', paidUntil: { $gte: activeSince } } }, { $group: { _id: null, orgs: { $sum: 1 }, seats: { $sum: '$seats' } } }]),
    Payment.find().sort({ createdAt: -1 }).limit(30).lean(),
    Invoice.countDocuments({ status: 'open' }),
    // Only real money counts toward the gate: Rwandan francs, not the fake provider (the MoMo sandbox uses EUR).
    Payment.aggregate([
      { $match: { status: 'successful', settledAt: { $gte: monthAgo }, currency: 'RWF', provider: { $ne: 'fake' } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);
  const invoices = await Invoice.find({ _id: { $in: payments.map((p) => p.invoiceId) } }).select('number');
  const users = await User.find({ _id: { $in: payments.map((p) => p.userId) } }).select('name phone');

  const realRwf = real[0]?.total ?? 0;
  const cost = config.SERVER_COST_MONTHLY_RWF;
  const seatRow = seats[0] ?? { orgs: 0, seats: 0 };
  const p = prices();

  res.json({
    generatedAt: new Date(),
    gate: { revenue30d: realRwf, serverCost: cost, costSet: cost > 0, passed: cost > 0 && realRwf >= cost },
    revenue30d: Object.fromEntries(revenue.map((r) => [r._id, { total: r.total, count: r.count }])),
    payments30d: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
    byProvider: Object.fromEntries(byProvider.map((s) => [s._id, { total: s.total, count: s.count }])),
    active: { family, orgs: seatRow.orgs, seats: seatRow.seats },
    // What active plans bring in per month at today's prices.
    monthlyEstimate: family * p.family + seatRow.seats * p.laptopSeat,
    openInvoices,
    prices: p,
    recentPayments: payments.map((x) => {
      const u = users.find((y) => y.id === String(x.userId));
      return {
        id: String(x._id),
        invoice: invoices.find((i) => i.id === String(x.invoiceId))?.number ?? null,
        by: u ? (u.name ?? u.phone) : null,
        provider: x.provider,
        payerPhone: x.payerPhone,
        amount: x.amount,
        currency: x.currency,
        status: x.status,
        failureReason: x.failureReason ?? null,
        providerTxnId: x.providerTxnId ?? null,
        createdAt: x.createdAt,
      };
    }),
  });
});

export default router;
