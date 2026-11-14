# Phase 5: Payments and scale (week 25 onward)

**Gate to pass:** paying customers cover server costs. The dashboard's **Billing** tab (admins only) compares real mobile money received in the last 30 days (Rwandan francs, not test payments) with `SERVER_COST_MONTHLY_RWF`.

## Built

**Plans** (dashboard → **Plans & billing**)
- [x] Protection stays free. Two paid things:
  - **Family plan** (`PRICE_FAMILY_MONTHLY_RWF`, 2,000 RWF a month by default): family sharing, and 90 days of location history instead of 30.
  - **Laptop seats** for organisations: `ORG_FREE_LAPTOPS` free (5 by default), then `PRICE_LAPTOP_SEAT_MONTHLY_RWF` (1,000 RWF) per extra laptop per month. Seats added mid-period are priced for the days left.
- [x] Paid for 1, 3, 6 or 12 months; paying again extends from the current end. Nothing renews by itself.
- [x] **A lapsed plan never switches off protection.** After 7 grace days: family sharing pauses, history goes back to 30 days (older points are deleted), and organisations cannot add laptops beyond their limit. Laptops already added keep working.

**Invoices and receipts**
- [x] Every purchase is an invoice numbered `NG-<year>-<6 digits>`, with an optional organisation name and TIN. Printable; it becomes a receipt once paid. Unpaid invoices can be cancelled.

**Mobile money**
- [x] MTN MoMo (Collection API: request to pay) and Airtel Money (Collection API). Each is on only when its keys are set. The person approves on their phone with their PIN; the page waits and shows the result.
- [x] A payment counts only after NexGuard asks the provider for its status. Provider callbacks (`/api/v1/billing/callbacks/<provider>?key=...`) only trigger that check. Pending payments are also checked every 30 seconds, and given up after 15 minutes.
- [x] The invoice is applied exactly once, even if a callback, the browser and the background check arrive together. The amount the provider reports must match the invoice.
- [x] The number must match the network (MTN 078/079, Airtel 072/073).
- [x] A fake provider for development and tests (never in production): numbers ending in 13 are declined, in 99 never answer, in 00 are refused.

**Family sharing**
- [x] The plan owner adds up to 5 people by phone number. Each person chooses which of their phones to share ("Share with my family" on the device). Family members see, ring, locate and send a message to shared phones; only the owner can lock, mark lost or remove a phone.

**Scale and operations** (see [operations.md](operations.md))
- [x] `GET /metrics` in Prometheus format: requests and timings per route, memory, event-loop delay, database up, devices seen in 24 hours, pending payments. Needs `METRICS_TOKEN` in production.
- [x] `npm run loadtest`: about **590 requests per second with no errors** on the development PC (≈175,000 phones per API process at one check-in every 5 minutes, before network time to a separate database).
- [x] `scripts/backup.sh`: daily compressed `mongodump`, read back before old archives are deleted, 14 days kept.
- [x] Admin **Billing** tab: the gate, active plans, what they bring in per month, payments by provider, recent payments with failure reasons.

**Other**
- [x] 7 new backend tests (73 in total), including the MTN and Airtel clients against a local fake server (headers, bodies, token reuse, amount check, callbacks).
- [x] Demo mode: the owner's family includes the neighbour, whose shared phone appears once the owner buys the Family plan with "Test payment".

## Checked in the browser (demo mode)

Bought the Family plan with the test provider: invoice NG-2026-000001, "approve on your phone" with the waiting indicator, paid, plan active for a month, the printable receipt. The neighbour's shared phone then appeared in My devices with "Shared by Demo Neighbour", Ring and Locate available and Lock turned off. The admin Billing tab showed the plan and 0 RWF of real money toward the gate.

## Not verified yet

- [ ] Real MTN MoMo and Airtel Money accounts. The clients follow the providers' published APIs and were tested against a local imitation only. Airtel may require message signing in Rwanda; check their current documents when the account is opened.
- [ ] `scripts/backup.sh` has not been run (the MongoDB Database Tools are not installed on this PC).
- [ ] The load test ran with the database on the same machine; repeat it against the real hosting.
- [ ] French and Kinyarwanda texts for billing and family sharing need native speakers.

## Needs you

- [ ] **Decide the prices** (the 2,000 and 1,000 RWF defaults are placeholders) and the free laptop count, then set them in `backend/.env`.
- [ ] **Open merchant accounts:** MTN MoMo (momodeveloper.mtn.com, then a production "collection" account for Rwanda) and Airtel Money (developers.airtel.africa). Set `MOMO_*` (with `MOMO_TARGET_ENV=mtnrwanda`, `MOMO_CURRENCY=RWF` in production), `AIRTEL_*`, `PUBLIC_API_URL` and `PAYMENT_CALLBACK_SECRET`.
- [ ] **Tax:** ask an accountant about VAT (18%) and the RRA's electronic invoicing (EBM) rules for these invoices, and register the business for VAT when required. The invoices do not show VAT yet.
- [ ] **Terms of use:** add the plans, what happens when one ends, and refunds (done by hand in the providers' portals).
- [ ] Set `SERVER_COST_MONTHLY_RWF` so the gate can be measured, and `METRICS_TOKEN` for monitoring.
- [ ] **Cards** (the plan's next step after mobile money): pick a card processor that settles in Rwanda.
- [ ] **IMEI blocking:** the talks with RURA, the operators and the police. A brief to start from: [imei-blocking-brief.md](imei-blocking-brief.md).

## Limits to know

- No automatic renewal: mobile money has no saved payment method. People get no reminder before a plan ends yet (an SMS 3 days before is the obvious next step).
- Refunds and disputes with the providers are handled by hand.
- Changing an organisation's seat count mid-period: adding seats is supported (prorated); removing seats takes effect at the next purchase.
