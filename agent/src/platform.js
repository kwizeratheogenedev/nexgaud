/**
 * What the agent does on each operating system, written as plain data (program, arguments,
 * environment) so it can be tested on any machine and never builds a shell command from text.
 * Text from the owner (a message to show) is passed as an argument or environment variable.
 */
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';

export function currentPlatform() {
  return { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform] ?? null;
}

const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];

// Windows location service through .NET (Windows PowerShell 5.1, which every Windows 10/11 has).
const WIN_LOCATION = [
  'Add-Type -AssemblyName System.Device',
  '$w = New-Object System.Device.Location.GeoCoordinateWatcher',
  '$w.Start()',
  '$t = 0',
  "while (($w.Status -ne 'Ready') -and ($w.Permission -ne 'Denied') -and ($t -lt 150)) { Start-Sleep -Milliseconds 100; $t++ }",
  "if ($w.Permission -eq 'Denied') { 'denied' } else { $c = $w.Position.Location; if ($c.IsUnknown) { 'unknown' } else { '{0},{1},{2}' -f $c.Latitude, $c.Longitude, $c.HorizontalAccuracy } }",
  '$w.Stop()',
].join('; ');

const WIN_BATTERY =
  "$b = Get-CimInstance Win32_Battery | Select-Object -First 1; if ($b) { '{0},{1}' -f $b.EstimatedChargeRemaining, $b.BatteryStatus } else { 'none' }";

// Plays the Windows alarm sound until NG_SECONDS have passed.
const WIN_RING =
  "$p = New-Object Media.SoundPlayer \"$env:WINDIR\\Media\\Alarm01.wav\"; $end = (Get-Date).AddSeconds([int]$env:NG_SECONDS); while ((Get-Date) -lt $end) { $p.PlaySync() }";

const WIN_MESSAGE =
  "Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show($env:NG_TEXT, 'NexGuard', 'OK', 'Warning')";

const shLoop = (player) => `end=$(( $(date +%s) + NG_SECONDS )); while [ "$(date +%s)" -lt "$end" ]; do ${player} || sleep 1; done`.replace('NG_SECONDS', '$NG_SECONDS');

/** Each action is a list of attempts; the first that works wins (Linux desktops differ). */
export function actionsFor(platform) {
  const table = {
    windows: {
      lock: () => [{ cmd: 'rundll32.exe', args: ['user32.dll,LockWorkStation'] }],
      ring: (seconds) => [{ cmd: 'powershell.exe', args: [...PS, WIN_RING], env: { NG_SECONDS: String(seconds) } }],
      message: (text) => [{ cmd: 'powershell.exe', args: [...PS, WIN_MESSAGE], env: { NG_TEXT: text }, detached: true }],
      location: () => [{ cmd: 'powershell.exe', args: [...PS, WIN_LOCATION], timeoutMs: 25000 }],
      battery: () => [{ cmd: 'powershell.exe', args: [...PS, WIN_BATTERY] }],
    },
    macos: {
      // Locks when "Require password after sleep" is on, which macOS sets by default.
      lock: () => [{ cmd: 'pmset', args: ['displaysleepnow'] }],
      ring: (seconds) => [{ cmd: '/bin/sh', args: ['-c', shLoop('afplay /System/Library/Sounds/Sosumi.aiff')], env: { NG_SECONDS: String(seconds) } }],
      message: (text) => [
        {
          cmd: 'osascript',
          args: ['-e', 'on run argv', '-e', 'display dialog (item 1 of argv) with title "NexGuard" buttons {"OK"} default button 1 with icon caution', '-e', 'end run', text],
          detached: true,
        },
      ],
      // macOS gives location only to signed apps with a usage description; the agent cannot ask yet.
      location: () => [],
      battery: () => [{ cmd: 'pmset', args: ['-g', 'batt'] }],
    },
    linux: {
      lock: () => [
        { cmd: 'loginctl', args: ['lock-session'] },
        { cmd: 'xdg-screensaver', args: ['lock'] },
      ],
      ring: (seconds) => [
        {
          cmd: '/bin/sh',
          args: ['-c', shLoop('paplay /usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga || canberra-gtk-play -i alarm-clock-elapsed')],
          env: { NG_SECONDS: String(seconds) },
        },
      ],
      message: (text) => [
        { cmd: 'zenity', args: ['--warning', '--title=NexGuard', `--text=${text}`, '--no-markup'], detached: true },
        { cmd: 'notify-send', args: ['-u', 'critical', 'NexGuard', text] },
      ],
      // GeoClue's demo client, installed with GeoClue on most desktops (Ubuntu, Fedora).
      location: () => [
        { cmd: '/usr/libexec/geoclue-2.0/demos/where-am-i', args: ['-t', '20'], timeoutMs: 25000 },
        { cmd: '/usr/lib/geoclue-2.0/demos/where-am-i', args: ['-t', '20'], timeoutMs: 25000 },
      ],
      battery: () => [],
    },
  };
  const actions = table[platform];
  if (!actions) throw new Error(`Unsupported platform: ${platform}`);
  return actions;
}

// ---- Parsing what the commands print ----

export function parseWindowsLocation(out) {
  const m = out.trim().match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?|NaN)$/);
  if (!m) return null;
  const accuracy = Number(m[3]);
  return { lat: Number(m[1]), lng: Number(m[2]), accuracyM: Number.isFinite(accuracy) ? accuracy : undefined, source: 'network' };
}

export function parseGeoclue(out) {
  const lat = out.match(/Latitude:\s+(-?\d+(?:\.\d+)?)/);
  const lng = out.match(/Longitude:\s+(-?\d+(?:\.\d+)?)/);
  if (!lat || !lng) return null;
  const acc = out.match(/Accuracy:\s+(\d+(?:\.\d+)?)/);
  return { lat: Number(lat[1]), lng: Number(lng[1]), accuracyM: acc ? Number(acc[1]) : undefined, source: 'wifi' };
}

export function parseWindowsBattery(out) {
  const m = out.trim().match(/^(\d+),(\d+)$/);
  // BatteryStatus 2 = on AC power; 6–9 = charging.
  return m ? { battery: Math.min(100, Number(m[1])), charging: [2, 6, 7, 8, 9].includes(Number(m[2])) } : null;
}

export function parseMacBattery(out) {
  const m = out.match(/(\d+)%;\s*(charging|discharging|charged|finishing charge|AC attached)/i);
  return m ? { battery: Number(m[1]), charging: !/^discharging$/i.test(m[2]) } : null;
}

export async function linuxBattery() {
  for (const name of ['BAT0', 'BAT1']) {
    try {
      const base = `/sys/class/power_supply/${name}`;
      const capacity = Number((await readFile(`${base}/capacity`, 'utf8')).trim());
      const status = (await readFile(`${base}/status`, 'utf8')).trim();
      return { battery: capacity, charging: status !== 'Discharging' };
    } catch {
      // try the next battery name
    }
  }
  return null;
}

// ---- Running ----

const dryRun = () => process.env.NEXGUARD_AGENT_DRY_RUN === '1';

function runOne(spec, log) {
  if (dryRun()) {
    log?.(`[dry run] ${spec.cmd} ${spec.args.length} argument(s)`);
    return Promise.resolve('');
  }
  const env = { ...process.env, ...(spec.env ?? {}) };
  if (spec.detached) {
    // Dialogs wait for a click: start them and move on.
    return new Promise((resolve, reject) => {
      const child = spawn(spec.cmd, spec.args, { env, detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve('');
      });
    });
  }
  return new Promise((resolve, reject) => {
    execFile(spec.cmd, spec.args, { env, timeout: spec.timeoutMs ?? 120000, windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout)),
    );
  });
}

/** Tries each attempt in turn. Returns the output of the first that works, or throws the last error. */
export async function runAttempts(attempts, log) {
  let lastError = new Error('Not available on this system');
  for (const spec of attempts) {
    try {
      return await runOne(spec, log);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** The real platform: what the agent calls. Tests pass a fake with the same shape. */
export function systemPlatform(platform = currentPlatform(), log) {
  const actions = actionsFor(platform);
  return {
    name: platform,
    osVersion: `${os.type()} ${os.release()}`.slice(0, 40),
    hostname: os.hostname().slice(0, 80),
    lock: () => runAttempts(actions.lock(), log),
    ring: (seconds) => runAttempts(actions.ring(seconds), log),
    message: (text) => runAttempts(actions.message(text), log),
    async location() {
      if (dryRun() || !actions.location().length) return null;
      const out = await runAttempts(actions.location(), log).catch(() => '');
      return platform === 'windows' ? parseWindowsLocation(out) : parseGeoclue(out);
    },
    async battery() {
      if (dryRun()) return null;
      if (platform === 'linux') return linuxBattery();
      const out = await runAttempts(actions.battery(), log).catch(() => '');
      return platform === 'windows' ? parseWindowsBattery(out) : parseMacBattery(out);
    },
    locationSupported: platform !== 'macos',
  };
}
