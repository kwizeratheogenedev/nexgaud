# Phase 0: Foundations (weeks 1–2)

**Gate to pass:** the CI pipeline deploys a test API to staging.

## Done in the repository

- [x] Repository with `backend/`, `dashboard/`, `android/`, `docs/`
- [x] Express 5 API skeleton: config validated with zod, pino logging (secrets redacted), helmet, CORS, JSON errors, `/api/v1/health`
- [x] MongoDB connection that keeps retrying, so the API stays up and `/health` reports the database state
- [x] Backend tests (node:test + supertest) and ESLint
- [x] Dashboard skeleton (React + Vite) with a live system-status card
- [x] Android skeleton (Kotlin + Compose), debug builds point at the local API
- [x] Backend Dockerfile for staging
- [x] GitHub Actions CI: backend lint + tests, dashboard build, Android debug APK

## Needs you (accounts and decisions)

- [x] Choose the product name: **NexGuard** by Nexera Digital Tech (Android package `rw.nexera.nexguard`)
- [ ] Check the trademark with RDB: the pet medicine brand "NexGard" exists, in a different industry
- [ ] Confirm the package name before Phase 1 (`rw.` assumes Nexera will own a .rw domain; use `com.nexera.nexguard` otherwise)
- [ ] Register the domain
- [ ] Create the GitHub organisation or repository and push this code (CI starts on the first push)
- [ ] Create a free MongoDB Atlas cluster and put its connection string in the staging `MONGODB_URI`
- [ ] Create a Firebase project (needed in Phase 1 for push commands: ring, lock)
- [ ] Pick a staging host (Render, Railway or a VPS) and deploy `backend/` with its Dockerfile
- [ ] Install Android Studio to run the app on an emulator or your phone

## Next: Phase 1 (weeks 3–8)

Gate: one phone reports its location for 7 days in a row with the screen locked.

1. Phone-number sign-up with SMS code, login, JWT refresh
2. Android: sign-in, step-by-step permission setup, battery-optimisation guide per phone brand
3. Android: location foreground service, offline queue (Room), batch upload
4. Backend: device pairing, location intake, last known location
5. Dashboard: device list, map with last location and 24-hour route
6. Ring and lock commands through Firebase Cloud Messaging, with confirmation
