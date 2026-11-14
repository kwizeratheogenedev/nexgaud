# Phase 3: Stolen-device registry (weeks 13–18)

**Gate to pass:** 5 partner shops check phones every week. The dashboard's **Registry admin → Statistics** tab (admins only) counts the shops with at least one check in the last 7 days.

## Built

**Registering devices** (dashboard → **IMEI registry**)
- [x] Register a phone, tablet, laptop or other device with up to two IMEIs and/or a serial number. IMEIs are checked (15 digits, Luhn check digit, no IMEISV, no all-same-digit fakes), with the reason shown in the user's language.
- [x] An IMEI belongs to one person. Registering one that someone else holds is refused, and the dispute form opens with the number filled in.
- [x] A registered phone can be linked to the tracked phone running the app.
- [x] Proof of ownership: up to 4 photos or PDFs (box, receipt, other), at most 3 MB each. The real file type is read from the bytes; files are served with a sandbox policy so they can never run as a page.

**Stolen and lost reports**
- [x] The owner reports a device stolen (police case number required) or lost, with when, where and details.
- [x] The NexGuard team reviews each report (owner's phone, case number, proof files, earlier reports) and approves or rejects it with a note. The owner gets an SMS either way.
- [x] Only approved reports show in checks. "I have it back" or "Withdraw" clears the flag; the team can also close a report.
- [x] A device with an open report cannot be deleted or handed over.

**Checking a phone**
- [x] Public page at `/check` (no account): shows "reported stolen / lost", "registered, not reported", "not in the registry" or why the number is invalid, with the device's make and model so the buyer can compare. Never the owner. `/check?q=<IMEI>` checks at once.
- [x] Every check of a reported device is an alert for the owner (with an SMS at most once a day), including while the report waits for review.
- [x] "Have you seen this phone?": anyone can send the owner a message and, if they want, their number.
- [x] USSD: dial the code, pick Kinyarwanda, English or French, type the IMEI, read the answer.
- [x] SMS: text `REBA <IMEI>` (or `CHECK`, `VERIFIER`, or only the IMEI) and get an SMS answer. At most 10 SMS checks per number per day.
- [x] Rate limits: 30 web checks per 15 minutes and 5 messages per hour per IP.

**Selling and disputes**
- [x] Handover: the seller makes an 8-character code (valid 72 hours, 5 tries); the buyer claims the device in their own account. Proof files and the tracked-phone link do not move to the buyer.
- [x] Disputes: "this device is mine" or "it shows as stolen but I bought it legally", with up to 4 proof files. The team rejects or upholds it, and can close the report or give the device to the claimant. Both people get an SMS.

**Partners** (dashboard → **Check phones**, for shop and police accounts)
- [x] Check up to 100 IMEIs or serials at once; reported phones are highlighted.
- [x] The last 7 days' checks and results (the numbers typed are not stored).
- [x] API keys for the shop's own software: `POST /api/v1/partner/check` with `Authorization: ApiKey <key>`. Keys are shown once and stored as a keyed hash; they can be revoked. A key cannot create keys.
- [x] Police partners also see the case number, station and place of a reported phone.

**Registry admin** (dashboard → **Registry admin**, English only)
- [x] Reviews: pending reports oldest first, with the proof files; lists of approved, rejected and closed reports.
- [x] Disputes: both sides, the evidence, the open report, and the decision.
- [x] Partners: add a shop or police unit, add members by phone number (they sign in with that number), remove members (signs them out), suspend.
- [x] Statistics: the gate, registered and reported devices, reports to review, open disputes, checks by channel and result, and checks per partner (shops with no checks this week are highlighted).
- [x] Search by IMEI, serial or the owner's phone number.
- [x] Audit log of every registration, report, review, dispute, handover, partner change, API key, and every time the team opens a proof file.

**Other**
- [x] 16 new backend tests (59 in total). Dashboard builds.
- [x] Demo mode adds a partner shop (`0788000005`), a stolen phone, a report waiting for review and a dispute. The IMEIs are printed at start.
- [x] Fixed: after signing out and in as someone else, the dashboard asked for the previous person's phone.

## Checked in the browser (demo mode)

Public check of a stolen IMEI and a finder's message (the owner got the alert and SMS); the IMEI typo message in Kinyarwanda; the "registered to someone else" conflict opening the dispute form; a handover code; the admin approving a report and rejecting a dispute; the audit log and statistics; a shop's bulk check of 4 IMEIs; the check page in Kinyarwanda at phone width; the USSD menu in French and Kinyarwanda. Uploading a proof file from the browser was not tried (the file picker cannot be driven); the API tests cover uploads.

## Not verified yet

- [ ] USSD and SMS through a real Africa's Talking account: needs a USSD code and a short code (or sender ID), which take time to get from the operators.
- [ ] Kinyarwanda and French texts (check page, registry, partner portal, USSD and SMS replies) need review by native speakers.
- [ ] Real-world false reports: how often owners report a phone they sold. The handover code and the review exist for this; watch the dispute queue.

## Needs you

- [ ] Recruit the 5 partner shops (Nyabugogo, Kigali city centre and Remera are the busiest second-hand markets), then add them in **Registry admin → Partners** with each clerk's phone number.
- [ ] Talk to RIB / Rwanda National Police: how they confirm a case number, and whether a police unit wants partner access.
- [ ] Africa's Talking: apply for a USSD service code and an SMS short code or sender ID. Then set `GATEWAY_SECRET`, `USSD_CODE` and `PUBLIC_CHECK_URL`, and set the callback URLs to `https://<api>/api/v1/gateway/ussd?key=<GATEWAY_SECRET>` and `.../gateway/sms?key=<GATEWAY_SECRET>`.
- [ ] Hosting: the web server must send `index.html` for `/check` (single-page app fallback), so printed QR codes and SMS links to `/check` work.
- [ ] Privacy policy: add the registry (IMEIs, proof photos, reports, checks kept for a year, the audit log) and the sharing with police partners. The lawyer should look at both.
- [ ] Before many users: move proof files out of MongoDB into object storage (they are stored in the database for the pilot).

## Limits to know

- The registry only knows what owners tell it. "Not in the registry" does not mean a phone is safe, and the page says so.
- A thief can change a phone's IMEI on some cheap models. The check shows the registered make and model so the buyer can spot a mismatch.
- Telecom operators can block IMEIs on their networks; NexGuard cannot. Sharing the stolen list with RURA and the operators is a later conversation.
- Android 10+ does not let apps read the IMEI, so owners type it from `*#06#` or the box. The Android app was not changed in this phase.

## Next: Phase 4 (weeks 19–24), tags and laptops

Gate: 100 tags in use and the laptop agent running on 3 operating systems.

1. QR tag generator, printable sticker sheets, finder page and message relay
2. Laptop agent for Windows first, then macOS and Linux
3. Organisation accounts for schools and companies
