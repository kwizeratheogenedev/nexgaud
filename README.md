# NexGuard

**NexGuard** by **Nexera Digital Tech** helps people find lost devices and makes stolen phones harder to resell. Three parts share one account and one backend:

1. **Tracker app** (Android first, laptops later): location, ring, lock, SIM-change alert.
2. **Stolen-device registry**: register an IMEI or serial number, report it stolen, and let anyone check it before buying.
3. **QR lost-and-found tags**: a finder scans a sticker and messages the owner.

The full analysis and plan (architecture, data model, API, roadmap, risks) is in the shared plan document; see [docs/phase-0.md](docs/phase-0.md) for where things stand.

> Android package name: `rw.nexera.nexguard`. It cannot change after the first Google Play release.

## Repository layout

| Folder | What it is | Stack |
| --- | --- | --- |
| `backend/` | REST API under `/api/v1` | Node.js 22+, Express 5, MongoDB (Mongoose), pino |
| `dashboard/` | Owner web dashboard | React 19, Vite |
| `android/` | Tracker app | Kotlin, Jetpack Compose |
| `docs/` | Plans and setup notes | Markdown |
| `.github/workflows/` | CI: lint, tests, builds | GitHub Actions |

## Run it locally

**Backend** (needs MongoDB locally or a MongoDB Atlas connection string):

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

The API listens on http://localhost:4000/api/v1. `GET /api/v1/health` returns `ok` when the database is connected and `degraded` (HTTP 503) when it is not.

**Dashboard:**

```bash
cd dashboard
npm install
npm run dev
```

Open http://localhost:5173. Vite forwards `/api` calls to the backend.

**Android:** open the `android/` folder in Android Studio (it installs the SDK and Gradle). Run it on an emulator; debug builds call the API at `http://10.0.2.2:4000/api/v1`, which is your PC's localhost.

## Tests

```bash
cd backend && npm test && npm run lint
```

CI runs the backend tests and lint, builds the dashboard, and builds a debug APK on every push and pull request.
