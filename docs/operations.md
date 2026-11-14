# Running NexGuard in production

## Monitoring

| What | How |
| --- | --- |
| Is it up? | An uptime check (every minute) on `GET /api/v1/health`: 200 and `"status": "ok"`, 503 when MongoDB is down. |
| Metrics | `GET /metrics` (Prometheus format) with `Authorization: Bearer <METRICS_TOKEN>`. Requests and timings per route, memory, event-loop delay, MongoDB up, devices seen in 24 hours, pending payments. Off in production until `METRICS_TOKEN` is set. |
| Logs | One JSON line per request (pino) on standard output. No tokens, gateway keys, checked IMEIs or conversation links are logged. Ship them to the hosting provider's log service. |

Alerts worth setting first:

1. Health check fails for 2 minutes.
2. `nexguard_db_up` is 0.
3. 5xx answers above 1% for 10 minutes (`http_requests_total{status=~"5.."}`).
4. `nexguard_devices_seen_24h` drops by more than 20% in a day (phones stopped reporting: an app or Android problem).
5. `nexguard_payments_pending` stays above 0 for more than 30 minutes (the payment check or a provider is stuck).

## Backups

`backend/scripts/backup.sh` makes a compressed `mongodump` archive, checks it can be read, and keeps 14 days. Run it daily from cron and copy the archives off the database server. MongoDB Atlas has its own scheduled backups; turn them on as well.

Test a restore at least once a month into a separate database; a backup nobody has restored is a guess.

The archives contain personal data (phone numbers, locations, proof photos): keep them encrypted and private.

## Capacity

`npm run loadtest` runs the real API against an in-memory database with simulated phones (70% heartbeats, 25% location uploads, 5% public checks).

Result on the development PC (Windows 11, one Node.js process, 2,000 devices, 50 requests at a time, 20 seconds): **about 590 requests per second, no errors**, p95 110 ms for heartbeats and 126 ms for location uploads. At one check-in per phone every 5 minutes that is roughly 175,000 phones per process, before network time to a separate database. The database will be the limit first: watch MongoDB's CPU and the size of the `locations` collection.

To grow: run several API processes behind a load balancer (the API keeps no state in memory except rate-limit counters, which then need a shared store), and move to a larger MongoDB tier.

## Payments

- Each provider is on only when its keys are set (`MOMO_*`, `AIRTEL_*`). The fake provider never runs in production.
- A payment counts only after NexGuard asks the provider for its status; callbacks only trigger that check. Pending payments are checked every 30 seconds and given up after 15 minutes.
- Set `PUBLIC_API_URL` and `PAYMENT_CALLBACK_SECRET` so MTN and Airtel can call `/api/v1/billing/callbacks/<provider>?key=...`.
- Refunds are done by hand in the provider's merchant portal. A payment approved twice for one invoice shows as `payment.duplicate` in the audit log.

## Secrets to set in production

`JWT_SECRET`, `HASH_SECRET` (32+ characters each), the SMS provider keys, `GATEWAY_SECRET`, `PAYMENT_CALLBACK_SECRET`, `METRICS_TOKEN`, the MoMo and Airtel keys, and `FIREBASE_SERVICE_ACCOUNT_B64` if push is used. Keep them in the hosting provider's secret store, never in the repository.
