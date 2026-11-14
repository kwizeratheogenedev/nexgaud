# NexGuard

**NexGuard** by **Nexera Digital Tech** helps people find lost devices and makes stolen phones harder to resell. Three parts share one account and one backend:

1. **Tracker app** (Android first, laptops later): location, ring, lock, SIM-change alert.
2. **Stolen-device registry**: register an IMEI or serial number, report it stolen, and let anyone check it before buying.
3. **QR lost-and-found tags**: a finder scans a sticker and messages the owner.

Status: Phase 3 (stolen-device registry) is built; the USSD and SMS checks wait for an Africa's Talking USSD code and short code. See [docs/phase-3.md](docs/phase-3.md) for the registry, [docs/phase-2.md](docs/phase-2.md) for the pilot work (still waiting for tests on real phones), and [docs/phase-1.md](docs/phase-1.md) for the tracker basics.

> Android package name: `rw.nexera.nexguard`. It cannot change after the first Google Play release.

## Repository layout

| Folder | What it is | Stack |
| --- | --- | --- |
| `backend/` | REST API under `/api/v1` | Node.js 22+, Express 5, MongoDB (Mongoose), JWT, pino |
| `dashboard/` | Owner dashboard, public check page, partner portal, admin | React 19, Vite, Leaflet + OpenStreetMap |
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

Open http://localhost:5173 and sign in with `0788000001`. The sign-in code is printed in the first terminal as `[dev SMS]`. Try **Ring**, **Locate now** or **Lock**: the simulated phone answers within 15 seconds. A minute after start the simulated phone gets a new SIM card, so an alert appears (and its SMS is printed). Sign in with `0788000009` instead to see the **Pilot statistics** and **Registry admin** tabs, or with `0788000005` for a partner shop's **Check phones** tab. The public check page is at http://localhost:5173/check (no sign-in); the first terminal prints a stolen IMEI to try.

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

**Map tiles:** the dashboard uses the public OpenStreetMap tiles, which are for light use only. Before launch set `VITE_TILE_URL` (and `VITE_TILE_ATTRIBUTION`) to a paid or self-hosted tile service.

**Admins:** `cd backend && npm run make-admin -- 0788123456` lets that account (after it has signed in once) open the pilot statistics and the registry admin.

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
| Everyone, no sign-in | `GET /check?q=`, `POST /check/tip` |
| Africa's Talking (`?key=GATEWAY_SECRET`) | `POST /gateway/ussd`, `POST /gateway/sms` |
| Partner (portal `Bearer` token, or `ApiKey`) | `GET /partner/me`, `GET /partner/check?q=`, `POST /partner/check` (up to 100), `GET /partner/checks`, `POST /partner/keys`, `DELETE /partner/keys/:id` (keys: portal only) |
| Admin (`Bearer` token, admin role) | `GET /admin/stats`, `GET /admin/registry/stats`, `GET /admin/registry/reports`, `POST /admin/registry/reports/:id/review`, `POST /admin/registry/reports/:id/close`, `GET /admin/registry/disputes`, `POST /admin/registry/disputes/:id/resolve`, `GET /admin/registry/uploads/:id`, `GET /admin/registry/items?q=`, `GET/POST /admin/partners`, `PATCH /admin/partners/:id`, `POST /admin/partners/:id/members`, `DELETE /admin/partners/:id/members/:userId`, `GET /admin/audit` |

## Tests

```bash
cd backend && npm test && npm run lint
```

The first run downloads a MongoDB test binary (about 780 MB, once). CI runs the backend tests and lint, builds the dashboard, and builds a debug APK on every push and pull request.
