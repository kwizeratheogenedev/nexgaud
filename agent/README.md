# NexGuard agent for laptops

Finds a lost or stolen laptop: it checks in with NexGuard every 2 minutes (every minute while the laptop is marked lost), sends its location, and rings, locks or shows a message when the owner asks. It uses the same device API as the Android app. No dependencies: only Node.js 22 or newer.

| | Windows 10/11 | macOS | Linux (desktop) |
| --- | --- | --- | --- |
| Ring | Windows alarm sound | `afplay` | `paplay` or `canberra-gtk-play` |
| Lock | `LockWorkStation` | `pmset displaysleepnow` (locks when "require password" is on) | `loginctl lock-session`, or `xdg-screensaver lock` |
| Message | Windows message box | `osascript` dialog | `zenity`, or `notify-send` |
| Location | Windows location service (Settings → Privacy → Location must be on) | Not yet (needs a signed helper app) | GeoClue (`where-am-i`) when installed |
| Battery | WMI | `pmset -g batt` | `/sys/class/power_supply` |
| Starts with the computer | `HKCU\...\Run` (no admin needed) | LaunchAgent | `systemd --user` service |
| Token stored | Encrypted for this Windows user (DPAPI) | File readable by this user only | File readable by this user only |

## Use

1. In the NexGuard dashboard: **My devices → Add a laptop** (or, for a school or company, **Organisation → Add a laptop**). You get an 8-character pairing code that works once, for 15 minutes.
2. On the laptop:

```bash
node src/cli.js pair ABCD-2345 --api https://<your API>/api/v1
node src/cli.js install
```

Other commands: `node src/cli.js status`, `node src/cli.js run` (in the foreground, to watch it), `node src/cli.js uninstall` (stops it, tells the owner as the Android app does, and forgets the pairing).

Settings and the log are in `%APPDATA%\NexGuard` (Windows), `~/Library/Application Support/NexGuard` (macOS) or `~/.config/nexguard` (Linux).

**Organisation laptops** show a notice the first time they run: "This laptop is managed by <organisation> with NexGuard…". Nobody is tracked without being told.

## For developers

- `npm test` runs the tests (no network, no real commands). CI runs them on Windows, macOS and Linux.
- `NEXGUARD_AGENT_DRY_RUN=1` logs ring, lock and message instead of doing them, and skips location and battery.
- `NEXGUARD_AGENT_HOME=<folder>` keeps settings somewhere else (useful for testing).
- `NEXGUARD_API_URL` sets the default API for `pair`.

Each action is written as data (program, arguments, environment) in `src/platform.js`; text from the owner is passed as an argument or an environment variable, never pasted into a script.

## Not done yet

- Installers: people need Node.js today. Next: one file per system with Node's single executable applications (`node --experimental-sea-config`), then a signed Windows installer and a signed macOS app (which would also allow location on macOS).
- Tested for real only on Windows 11 (in dry-run mode). macOS and Linux are covered by the unit tests only.
