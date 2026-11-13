# Phase 1: MVP tracker (weeks 3–8)

**Gate to pass:** one phone reports its location for 7 days in a row with the screen locked.

## Built

**Backend**
- [x] Sign-in by SMS code: 6-digit codes stored as HMAC, 10-minute expiry, one resend per minute, 5 sends and 5 wrong tries per code, per-IP limits
- [x] Access tokens (15 min) and refresh tokens (30 days, httpOnly cookie for the web), sign out everywhere
- [x] Phone pairing with a long random device token (only its HMAC is stored), up to 10 devices per account
- [x] Location upload in batches of up to 500, last known location, 30-day history (deleted automatically), history by time range
- [x] Heartbeat: battery, network, permissions, SIM fingerprint, push token
- [x] Commands: ring, lock, locate, message. Queued, delivered with the next upload or heartbeat, acknowledged by the phone, expired after 24 hours
- [x] Optional Firebase push to wake the phone at once
- [x] Africa's Talking SMS provider (or console codes in development)
- [x] 30 automated tests, including privacy between accounts
- [x] Demo mode with a simulated phone (`npm run demo`)

**Dashboard**
- [x] Sign-in by SMS code
- [x] Device list with online/offline and battery
- [x] Map with last location, accuracy circle and 24-hour route
- [x] Ring, Locate now, Lock, Show message, with live status of each action
- [x] Mark as lost / I found it, remove device
- [x] Warnings when the phone is missing a permission
- [x] Works on phone screens

**Android app** (compiles; Android Lint reports 0 errors; not yet run on a phone)
- [x] Sign-in by SMS code and pairing
- [x] Guided setup: notifications, precise location, "Allow all the time", battery tips per phone brand, optional remote lock
- [x] Foreground location service: about every 5 minutes, every minute in lost mode
- [x] Offline queue (Room) and upload worker with retries
- [x] Backup worker every 15 minutes for phones that kill the service
- [x] Restart after reboot
- [x] Ring at full alarm volume, lock the screen, fresh location, show the owner's message
- [x] Firebase push (configured by build settings, no google-services.json)

## Not verified yet

- [x] The Android app compiles (`./gradlew assembleDebug`), and Android Lint reports 0 errors. The only warnings are newer library versions, left for a separate upgrade.
- [ ] Install the debug APK and test on real phones: Tecno, Infinix, itel, Samsung; Android 10 to 15
- [ ] Real SMS through Africa's Talking (needs an account and sender ID)
- [ ] Firebase push end to end

## Left for Phase 2 (from the plan)

- PIN or fingerprint to stop protection or uninstall
- SIM-change alert to the owner (the fingerprint is already collected)
- Last location saved when the battery is low
- Encrypt the device token on the phone with the Android Keystore
- Keep location history of devices marked lost beyond 30 days
- Kinyarwanda and French translations
- A paid or self-hosted map tile service (the free OpenStreetMap tiles are slow and not meant for production)
