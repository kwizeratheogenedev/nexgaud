# Phase 4: Tags and laptops (weeks 19–24)

**Gate to pass:** 100 tags in use, and the laptop agent running on 3 operating systems. The dashboard's **Tags & laptops** tab (admins only) shows both: tags that are active or marked lost, and systems with an agent seen in the last 7 days.

## Built

**QR lost-and-found tags** (dashboard → **Tags**)
- [x] Make up to 20 tags at a time, with what it is (keys, bag, wallet, laptop, phone, pet, other) and a message for the finder. Each tag has an 8-character code without look-alike characters; the QR code holds only the link `<PUBLIC_APP_URL>/t/<code>`.
- [x] Printable sticker sheets (A4, 24 per page): QR code, "Found it? Scan me", the code and the item's name.
- [x] Mark an item lost (the finder page says the owner is looking for it), mark it found, edit, or turn the tag off (the sticker then says it is no longer in use, and its conversations are deleted).
- [x] Every scan is an alert; it is also texted while the item is marked lost. Reloading the page in the same browser is not a new scan.

**Finder page** (`/t/<code>`, no account, English, French, Kinyarwanda)
- [x] Shows the item, the owner's message, and "the owner is looking for it" when lost. Never who the owner is (an organisation's name is shown).
- [x] The finder writes to the owner, and may add their number, let the owner see it, and share their location.
- [x] Message relay: the owner replies in the dashboard; the finder sees the reply on the tag page (the conversation link stays in their browser), and gets it by SMS if they left a number. The owner sees the finder's number only if the finder allowed it.
- [x] Up to 20 open conversations per tag, 50 messages each; conversations are deleted 180 days after the last message.

**Printed batches for shops and schools** (admin → **Tags & laptops**)
- [x] The team makes batches of up to 500 unclaimed tags and prints them with a 6-character claim code beside each. The buyer activates a tag in **Tags → Have a printed tag?** with both codes (5 wrong claim codes lock the tag). Printing is logged.

**Laptop agent** (`agent/`, see [agent/README.md](../agent/README.md))
- [x] Node.js 22, no dependencies. Windows, macOS and Linux: ring, lock, message, battery, starts with the computer, lost-mode message. Location on Windows (location service) and Linux (GeoClue); not yet on macOS.
- [x] Pairing: the dashboard makes a one-time code (15 minutes); the agent swaps it for its device token. The token is encrypted with DPAPI on Windows, and kept in a file only the user can read elsewhere.
- [x] Uninstalling alerts the owner ("protection was turned off"), as the Android app does.
- [x] 8 agent tests, run in CI on Windows, macOS and Linux.

**Organisations** (dashboard → **Organisation**)
- [x] Anyone can start one (school, company, NGO), up to 3 each, and add managers by phone number (up to 50). Managers see and control the organisation's laptops and tags, never each other's personal devices.
- [x] Organisation laptops are enrolled with an organisation pairing code, can be "assigned to" a person or room, and show a notice that the organisation manages them. Their alerts go to every manager.
- [x] The NexGuard team can suspend an organisation.

**Other**
- [x] 7 new backend tests (66 in total). The dashboard builds. The audit log now also records tags, batches, pairings and organisation changes.
- [x] Demo mode adds a demo school managed by the owner, two tags (one with a finder's message) and a printed batch of 6.

## Checked

In the browser (demo mode): the finder page with a lower-case, dashed code; a finder's message (the owner's SMS); the owner's reply and the finder's SMS; the conversation on the finder page in Kinyarwanda at phone width; the sticker sheet and the batch sheet with claim codes; an organisation pairing code.

On this Windows 11 computer, the real agent (dry-run mode, settings in a scratch folder): paired with that code, stored the token with DPAPI, showed the organisation notice, ran Ring and Lock from the dashboard on its next check-in and confirmed them, and on uninstall both school managers got the SMS. Location was not read and nothing was rung or locked for real.

## Not verified yet

- [ ] The agent for real (sound, lock, message box, Windows location) on several Windows laptops, and on a Mac and a Linux desktop. Until then the gate's "3 systems" cannot pass.
- [ ] Printed stickers: scanning them with common phones, and how long paper stickers with tape last.
- [ ] Kinyarwanda and French texts (tags, finder page, organisation, SMS) need review by native speakers.

## Needs you

- [ ] Set `PUBLIC_APP_URL` to the dashboard's real address **before printing any tags**: printed QR codes cannot change. Use a short domain you will keep.
- [ ] Hosting: the web server must send `index.html` for `/t/...` (as for `/check`).
- [ ] Order sticker paper (or a print shop) and decide the price of tag packs.
- [ ] Find one school and one company for a first organisation pilot, with at least one Mac and one Linux laptop.
- [ ] Privacy policy and terms: add tags (finder messages, optional finder number and location) and organisations (managers see organisation laptops' locations; laptops show a notice). Employees' and pupils' laptops are a sensitive case: the lawyer should look at it.
- [ ] Packaging the agent (see agent/README.md): today people need Node.js installed.

## Limits to know

- Anyone holding a sticker's claim code can activate it: keep unsold sheets away from customers.
- A finder who clears their browser loses the conversation link; if they left a number, they still get replies by SMS.
- macOS laptops cannot send their location yet.
- Laptops have no push service: commands arrive within 2 minutes (1 minute when marked lost).

## Next: Phase 5 (week 25 onward), payments and scale

Gate: paying customers cover server costs.

1. MTN MoMo and Airtel Money payments, then cards
2. Paid plans, family sharing, invoices for organisations
3. Talks with RURA, the operators and the police on IMEI blocking
4. Load tests, backups, monitoring
