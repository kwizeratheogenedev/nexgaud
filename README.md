# NexGuard

**NexGuard** by **Nexera Digital Tech** helps people find lost devices and makes stolen phones harder to resell. Three parts share one account and one backend:

1. **Tracker app** (Android first, laptops later): location, ring, lock, SIM-change alert.
2. **Stolen-device registry**: register an IMEI or serial number, report it stolen, and let anyone check it before buying.
3. **QR lost-and-found tags**: a finder scans a sticker and messages the owner.

Status: Phase 1 (MVP tracker) is in progress. See [docs/phase-1.md](docs/phase-1.md) for what works and what is left.

> Android package name: `rw.nexera.nexguard`. It cannot change after the first Google Play release.

## Repository layout

| Folder | What it is | Stack |
| --- | --- | --- |
| `backend/` | REST API under `/api/v1` | Node.js 22+, Express 5, MongoDB (Mongoose), JWT, pino |
| `dashboard/` | Owner web dashboard | React 19, Vite, Leaflet + OpenStreetMap |
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

Open http://localhost:5173 and sign in with `0788000001`. The sign-in code is printed in the first terminal as `[dev SMS]`. Try **Ring**, **Locate now** or **Lock**: the simulated phone answers within 15 seconds.

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

**Instant ring and lock (optional):** without Firebase, a phone receives commands when it next uploads its location (within about 5 minutes). For instant delivery:

1. Create a Firebase project and add an Android app with package `rw.nexera.nexguard`.
2. Backend: put the base64 of the service-account JSON in `FIREBASE_SERVICE_ACCOUNT_B64`.
3. Android: add `nexguard.fcm.appId`, `nexguard.fcm.apiKey`, `nexguard.fcm.projectId` and `nexguard.fcm.senderId` to `~/.gradle/gradle.properties`.

## API at a glance

| Who | Endpoints |
| --- | --- |
| Everyone | `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout` |
| Owner (`Bearer` token) | `GET/PATCH /auth/me`, `GET/POST /devices`, `GET/PATCH/DELETE /devices/:id`, `GET /devices/:id/locations`, `GET/POST /devices/:id/commands` |
| Phone (`Device` token) | `POST /device/locations`, `POST /device/heartbeat`, `GET /device/commands`, `POST /device/commands/:id/ack`, `GET /device/me` |

## Tests

```bash
cd backend && npm test && npm run lint
```

The first run downloads a MongoDB test binary (about 780 MB, once). CI runs the backend tests and lint, builds the dashboard, and builds a debug APK on every push and pull request.
