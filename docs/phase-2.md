# Phase 2: Pilot and hardening (weeks 9–12)

**Gate to pass:** 50 pilot users, with 90% of devices seen in the last 24 hours. The dashboard's **Pilot statistics** tab (admins only) shows both numbers live.

## Built

**Alerts to the owner**
- [x] SIM change: the phone sends a one-way SIM fingerprint (network, country and subscription ID; no phone number, no SIM serial). A different SIM, or no SIM, raises an alert. The first report only sets the baseline.
- [x] Low battery: when Android reports low battery, the phone sends a fresh location (once per low-battery spell).
- [x] Switching off: the phone sends its last known location while it shuts down (best effort: Android allows only a few seconds).
- [x] Protection stopped, remote lock turned off, 5 wrong PINs: each raises an alert.
- [x] SMS for the alerts that matter, in the owner's language (English, French, Kinyarwanda): always for SIM, protection and PIN alerts; for low battery and switching off only while the phone is marked lost. At most one SMS per alert type per device per hour.
- [x] Dashboard: alerts menu with unread count, "mark all as read", alerts per device, "SIM changed" line on the device.

**Lost mode**
- [x] Marking a phone lost takes a message and a number to call; both reach the phone with its next sync (or at once with Firebase).
- [x] The phone shows a finder's screen (message and "Call the owner"), also over the lock screen, plus a lock-screen notification with a call button.
- [x] The owner gets past the finder's screen with their PIN.
- [x] Location history of a lost or stolen phone is kept for 365 days instead of 30; marking it found brings back the 30-day limit.

**Harder to switch off**
- [x] PIN (4 to 8 digits) chosen during setup, needed to stop protection and to change the PIN. Stored as a salted PBKDF2 hash. 5 wrong tries lock it for 5 minutes and alert the owner with the phone's location.
- [x] Turning off remote lock (needed before uninstalling) shows a warning and alerts the owner.
- [x] The device token is encrypted with an Android Keystore key. Tokens saved by version 0.2 are encrypted on first start.

**Languages**
- [x] Android app: English, French, Kinyarwanda (follows the phone's language; Android 13+ also offers a per-app choice in Settings).
- [x] Dashboard: language picker on the sign-in page and the top bar; the choice is saved to the account, and alert SMS use it.

**Pilot and launch preparation**
- [x] Pilot statistics for admins: gate progress, devices seen in 24 hours by brand and Android version, setup problems, alerts in the last 7 days, and phones quiet for over a day. Counts and phone models only: no locations, no phone numbers.
- [x] `npm run make-admin -- <phone>` gives a team member access (they must have signed in once).
- [x] Draft privacy policy and terms of use at `/privacy.html` and `/terms.html` on the dashboard (linked from sign-in). **Drafts: a lawyer must complete and review them.**
- [x] Release signing from Gradle properties (`nexguard.signing.*`), app version 0.3.0.
- [x] Map tiles configurable with `VITE_TILE_URL` and `VITE_TILE_ATTRIBUTION`.
- [x] 13 new backend tests (43 in total). Android builds with 0 lint errors.

## Not verified yet

- [ ] Everything on the Android side has only been compiled, not run on a phone. In particular: the finder's screen over the lock screen, the switch-off alert, the low-battery alert, and SIM detection on dual-SIM phones (changing the default SIM may look like a SIM change).
- [ ] Kinyarwanda and French texts (app, dashboard, SMS) need review by native speakers.
- [ ] The privacy policy and terms need a lawyer, and the [bracketed] items filled in.

## Needs you

- [ ] Recruit the 50 pilot users (friends, family, a partner shop), with a mix of Tecno, Infinix, itel and Samsung phones.
- [ ] Start the NCSA registration as a data controller (Law No. 058/2021). Needed before a public launch and before storing data outside Rwanda.
- [ ] Choose where the servers run (inside Rwanda, or abroad with NCSA authorisation) and fill that into the privacy policy.
- [ ] Pick a map tile service for production (for example MapTiler or Stadia Maps, or self-hosted) and set `VITE_TILE_URL`.
- [ ] Create the Google Play developer account, then:
  1. Create an upload key: `keytool -genkeypair -v -keystore nexguard-upload.jks -keyalg RSA -keysize 4096 -validity 10000 -alias upload`. Keep it and its passwords safe, outside the repository.
  2. Put `nexguard.signing.storeFile`, `storePassword`, `keyAlias` and `keyPassword`, plus `nexguard.apiUrl.release`, in `~/.gradle/gradle.properties`.
  3. Build: `cd android && ./gradlew bundleRelease`, and upload `app/build/outputs/bundle/release/app-release.aab` to **Internal testing**.
  4. Fill in the Data safety form (location, phone number, device IDs: collected, not shared, encrypted in transit) and link the privacy policy URL.
  5. Background location review: record a short video of the setup screens showing the explanation before Android's "Allow all the time" prompt, and explain that finding a lost phone needs location while the app is closed.
- [ ] Device admin is a sensitive permission on Google Play. The app uses only "force lock", explains it, and lets the user decline; mention this in the review notes.

## Limits to know

- NexGuard cannot stop a factory reset or an uninstall. The PIN, the device-admin warning and the alerts make them slower and tell the owner, nothing more.
- Fingerprint unlock for the PIN was left out for now (needs `androidx.biometric`); the PIN works on every phone.
- A thief who switches the phone off straight away leaves only the last known location.

## Next: Phase 3 (weeks 13–18), stolen-device registry

Gate: 5 partner shops check phones every week.

1. IMEI and serial registration with proof upload (box or receipt photo)
2. Stolen-report flow with admin review and police case number
3. Public check web page, then USSD and SMS through a gateway
4. Partner portal with API keys and bulk checks
5. Admin panel: review queue, disputes, statistics, audit log
