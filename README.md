# NexGuard

**NexGuard** by **Nexera Digital Tech** helps people find lost devices and makes stolen phones harder to resell. Three parts share one account and one backend:

1. **Tracker app** (Android first, laptops later): location, ring, lock, SIM-change alert.
2. **Stolen-device registry**: register an IMEI or serial number, report it stolen, and let anyone check it before buying.
3. **QR lost-and-found tags**: a finder scans a sticker and messages the owner.

Status: Phase 5 (plans, mobile money payments, family sharing, monitoring) is built; payments have been tested against MTN and Airtel imitations only, until merchant accounts are opened. See [docs/phase-5.md](docs/phase-5.md) and [docs/operations.md](docs/operations.md). Earlier phases: [tags and laptops](docs/phase-4.md), [stolen-device registry](docs/phase-3.md), [pilot](docs/phase-2.md), [tracker](docs/phase-1.md).

> Android package name: `rw.nexera.nexguard`. It cannot change after the first Google Play release.

## Repository layout

| Folder | What it is | Stack |
| --- | --- | --- |
| `backend/` | REST API under `/api/v1` | Node.js 22+, Express 5, MongoDB (Mongoose), JWT, pino |
| `dashboard/` | Owner dashboard, public check page, partner portal, admin | React 19, Vite, Leaflet + OpenStreetMap |
| `agent/` | Laptop agent (Windows, macOS, Linux) | Node.js 22, no dependencies |
| `android/` | Tracker app | Kotlin, Jetpack Compose, Fused Location, WorkManager, Room |
| `docs/` | Plans and setup notes | Markdown |
| `.github/workflows/` | CI: lint, tests, builds | GitHub Actions |

## Try it in 2 minutes (no MongoDB, no phone)

Demo mode runs an in-memory database and a simulated phone that walks around central Kigali and answers commands.

```bash
cd backend
npm install
npm run demo
```

In a second terminal:

```bash
cd dashboard
npm install
npm run dev
```

Open http://localhost:5173 and sign in with `0788000001`. The sign-in code is printed in the first terminal as `[dev SMS]`. Try **Ring**, **Locate now** or **Lock**: the simulated phone answers within 15 seconds. A minute after start the simulated phone gets a new SIM card, so an alert appears (and its SMS is printed). Sign in with `0788000009` instead to see the **Pilot statistics** and **Registry admin** tabs, or with `0788000005` for a partner shop's **Check phones** tab. The public check page is at http://localhost:5173/check (no sign-in); the first terminal prints a stolen IMEI to try, and the finder page of a demo QR tag. The demo owner also manages a demo school (**Organisation** tab), and can buy the Family plan with **Test payment** on **Plans & billing** to see a phone the neighbour shares.

## Run it for real

**Backend** (needs MongoDB locally or a MongoDB Atlas connection string):

```bash
cd backend
cp .env.example .env
npm run dev
```

Edit `.env` first; every setting is explained there. In development, sign-in codes are printed in the terminal (`SMS_PROVIDER=console`). Production needs `JWT_SECRET`, `HASH_SECRET` and a real SMS provider, or the API refuses to start.

**Dashboard:** `cd dashboard && npm run dev`, then open http://localhost:5173. Vite forwards `/api` calls to the backend.

**Android:** open the `android/` folder in Android Studio, or build from the command line with `cd android && ./gradlew assembleDebug` (needs Java 17 and the Android SDK; set `sdk.dir` in `android/local.properties`). The APK lands in `android/app/build/outputs/apk/debug/`. Run on an emulator: debug builds call the API at `http://10.0.2.2:4000/api/v1`, your PC's localhost. To use a real phone on the same Wi-Fi, add `nexguard.apiUrl.debug=http://<your-PC-IP>:4000/api/v1` to `android/gradle.properties`.

**Map tiles:** the map has two views, **Map** (OpenStreetMap) and **Satellite** (Esri World Imagery, with roads and place names on top), switched with the button at the top right of the map. Both public services are for light use only. Before launch, set `VITE_TILE_URL` (and `VITE_TILE_ATTRIBUTION`) to a paid or self-hosted street map, and `VITE_SATELLITE_URL` (and `VITE_SATELLITE_ATTRIBUTION`) to a satellite service you have an account with (for example Esri ArcGIS, MapTiler or Mapbox).

**Admins:** `cd backend && npm run make-admin -- 0788123456` lets that account (after it has signed in once) open the pilot statistics and the registry admin.

**Laptops:** in the dashboard, **My devices → Add a laptop** makes a pairing code; see [agent/README.md](agent/README.md).

**QR tags:** set `PUBLIC_APP_URL` (in `backend/.env`) to the dashboard's real address before printing any tags. The web server must serve `index.html` for `/t/...`.

**Payments:** MTN MoMo and Airtel Money turn on when their keys are set in `backend/.env` (see the Phase 5 section of `.env.example`). Monitoring, backups and the load test: [docs/operations.md](docs/operations.md).

**Partner shops and police:** an admin adds them in **Registry admin → Partners**, with each member's phone number. Members sign in with that number and get the **Check phones** tab.

**USSD and SMS checks:** set `GATEWAY_SECRET` and point Africa's Talking at `/api/v1/gateway/ussd?key=...` and `/api/v1/gateway/sms?key=...` (see `backend/.env.example`). In production the web server must serve `index.html` for `/check`.

**Release build for Google Play:** see "Needs you" in [docs/phase-2.md](docs/phase-2.md) for the upload key and the `nexguard.signing.*` settings.

**Instant ring and lock (optional):** without Firebase, a phone receives commands when it next uploads its location (within about 5 minutes). For instant delivery:

1. Create a Firebase project and add an Android app with package `rw.nexera.nexguard`.
2. Backend: put the base64 of the service-account JSON in `FIREBASE_SERVICE_ACCOUNT_B64`.
3. Android: add `nexguard.fcm.appId`, `nexguard.fcm.apiKey`, `nexguard.fcm.projectId` and `nexguard.fcm.senderId` to `~/.gradle/gradle.properties`.

## API at a glance

| Who | Endpoints |
| --- | --- |
| Everyone | `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout` |
| Owner (`Bearer` token) | `GET/PATCH /auth/me`, `GET/POST /devices`, `GET/PATCH/DELETE /devices/:id` (PATCH also marks lost, with `lostMessage` and `contactPhone`), `GET /devices/:id/locations`, `GET/POST /devices/:id/commands`, `GET /alerts`, `POST /alerts/read` |
| Phone (`Device` token) | `POST /device/locations`, `POST /device/heartbeat`, `POST /device/events`, `GET /device/commands`, `POST /device/commands/:id/ack`, `GET /device/me` |
| Owner, registry | `GET/POST /registry/items`, `PATCH/DELETE /registry/items/:id`, `POST /registry/items/:id/proofs?kind=` (raw image or PDF body), `GET/DELETE /registry/items/:id/proofs/:proofId`, `POST /registry/items/:id/reports`, `POST /registry/items/:id/reports/close`, `POST/DELETE /registry/items/:id/transfer`, `POST /registry/claim`, `GET/POST /registry/disputes`, `POST /registry/disputes/:id/evidence` |
| Everyone, no sign-in | `GET /check?q=`, `POST /check/tip`, `GET /tags/public/:code`, `POST /tags/public/:code/threads`, `GET /tags/public/threads/:token`, `POST /tags/public/threads/:token/messages` |
| Owner, tags and organisations | `POST /devices/pairing-codes`, `GET/POST /tags`, `POST /tags/claim`, `PATCH/DELETE /tags/:id`, `GET /tags/threads/all`, `POST /tags/threads/:id/read`, `POST /tags/threads/:id/reply`, `POST /tags/threads/:id/close`, `GET/POST /orgs`, `PATCH /orgs/:id`, `POST /orgs/:id/members`, `DELETE /orgs/:id/members/:userId` |
| Owner, plans | `GET /billing/me`, `POST /billing/checkout`, `GET /billing/invoices`, `GET /billing/invoices/:id`, `POST /billing/invoices/:id/pay`, `POST /billing/invoices/:id/void`, `GET /billing/payments/:id`, `GET/POST/DELETE /family`, `POST /family/members`, `DELETE /family/members/:userId` |
| MTN / Airtel (`?key=PAYMENT_CALLBACK_SECRET`) | `POST /billing/callbacks/:provider` |
| Monitoring (`Bearer METRICS_TOKEN`) | `GET /metrics` (outside `/api/v1`) |
| Laptop agent | `POST /device/pair` (pairing code), then the same `Device` token routes as the phone |
| Africa's Talking (`?key=GATEWAY_SECRET`) | `POST /gateway/ussd`, `POST /gateway/sms` |
| Partner (portal `Bearer` token, or `ApiKey`) | `GET /partner/me`, `GET /partner/check?q=`, `POST /partner/check` (up to 100), `GET /partner/checks`, `POST /partner/keys`, `DELETE /partner/keys/:id` (keys: portal only) |
| Admin (`Bearer` token, admin role) | `GET /admin/stats`, `GET /admin/registry/stats`, `GET /admin/registry/reports`, `POST /admin/registry/reports/:id/review`, `POST /admin/registry/reports/:id/close`, `GET /admin/registry/disputes`, `POST /admin/registry/disputes/:id/resolve`, `GET /admin/registry/uploads/:id`, `GET /admin/registry/items?q=`, `GET/POST /admin/partners`, `PATCH /admin/partners/:id`, `POST /admin/partners/:id/members`, `DELETE /admin/partners/:id/members/:userId`, `GET /admin/audit`, `GET /admin/phase4/stats`, `GET/POST /admin/tag-batches`, `GET /admin/tag-batches/:id/tags`, `GET /admin/orgs`, `PATCH /admin/orgs/:id`, `GET /admin/billing/stats` |

## Tests

```bash
cd backend && npm test && npm run lint
cd ../agent && npm test
```

The first run downloads a MongoDB test binary (about 780 MB, once). CI runs the backend tests and lint, builds the dashboard, and builds a debug APK on every push and pull request.
