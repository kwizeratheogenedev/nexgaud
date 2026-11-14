/**
 * Where the agent keeps its settings and device token, and how it starts with the computer.
 * - Windows: %APPDATA%\NexGuard; the token is encrypted for this Windows user (DPAPI).
 * - macOS: ~/Library/Application Support/NexGuard; Linux: ~/.config/nexguard. The file is readable by this user only.
 */
import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function configDir(platform, env = process.env, home = os.homedir()) {
  if (env.NEXGUARD_AGENT_HOME) return env.NEXGUARD_AGENT_HOME;
  if (platform === 'windows') return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'NexGuard');
  if (platform === 'macos') return path.posix.join(home, 'Library', 'Application Support', 'NexGuard');
  return path.posix.join(env.XDG_CONFIG_HOME ?? path.posix.join(home, '.config'), 'nexguard');
}

const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
const DPAPI = (fn) =>
  `Add-Type -AssemblyName System.Security; ${fn}`;
const PROTECT = DPAPI(
  "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($env:NG_SECRET), $null, 'CurrentUser'))",
);
const UNPROTECT = DPAPI(
  "[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($env:NG_SECRET), $null, 'CurrentUser'))",
);

function powershell(script, secret) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [...PS, script], { env: { ...process.env, NG_SECRET: secret }, windowsHide: true, timeout: 30000 }, (err, out) =>
      err ? reject(err) : resolve(String(out).trim()),
    );
  });
}

export class Store {
  constructor(platform, dir = configDir(platform)) {
    this.platform = platform;
    this.dir = dir;
    this.file = path.join(dir, 'agent.json');
  }

  async load() {
    try {
      return JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      return null;
    }
  }

  async save(config) {
    await mkdir(this.dir, { recursive: true });
    if (this.platform !== 'windows') await chmod(this.dir, 0o700).catch(() => {});
    await writeFile(this.file, JSON.stringify(config, null, 2), { mode: 0o600 });
  }

  async update(changes) {
    const config = (await this.load()) ?? {};
    await this.save({ ...config, ...changes });
  }

  /** Encrypts the token with DPAPI on Windows (only this Windows user can read it back). */
  async protectToken(token) {
    if (this.platform === 'windows' && process.env.NEXGUARD_AGENT_PLAIN_TOKEN !== '1') {
      try {
        return { token: await powershell(PROTECT, token), tokenProtection: 'dpapi' };
      } catch {
        // Fall back to a file only this user can read.
      }
    }
    return { token, tokenProtection: 'file' };
  }

  async readToken(config) {
    if (config.tokenProtection === 'dpapi') return powershell(UNPROTECT, config.token);
    return config.token;
  }

  async remove() {
    await rm(this.file, { force: true });
  }
}

// ---- Starting with the computer ----

/**
 * Files to write and commands to run so the agent starts when this user signs in.
 * Per user, not a system service: ringing, messages and locking need the user's desktop session.
 */
export function autostartPlan(platform, { node, cli, dir, home }) {
  if (platform === 'windows') {
    // A tiny VBScript starts Node without a console window.
    const vbs = path.win32.join(dir, 'start-agent.vbs');
    return {
      files: [{ path: vbs, content: `CreateObject("WScript.Shell").Run """${node}"" ""${cli}"" run", 0, False\r\n` }],
      install: [
        { cmd: 'reg', args: ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'NexGuardAgent', '/t', 'REG_SZ', '/d', `wscript.exe "${vbs}"`, '/f'] },
        { cmd: 'wscript.exe', args: [vbs], detached: true },
      ],
      uninstall: [{ cmd: 'reg', args: ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'NexGuardAgent', '/f'] }],
      removeFiles: [vbs],
    };
  }
  if (platform === 'macos') {
    const plist = path.posix.join(home, 'Library', 'LaunchAgents', 'rw.nexera.nexguard.agent.plist');
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>rw.nexera.nexguard.agent</string>
  <key>ProgramArguments</key>
  <array><string>${esc(node)}</string><string>${esc(cli)}</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>${esc(path.posix.join(dir, 'agent.err.log'))}</string>
</dict>
</plist>
`;
    return {
      files: [{ path: plist, content }],
      install: [{ cmd: 'launchctl', args: ['load', '-w', plist] }],
      uninstall: [{ cmd: 'launchctl', args: ['unload', '-w', plist] }],
      removeFiles: [plist],
    };
  }
  const unit = path.posix.join(home, '.config', 'systemd', 'user', 'nexguard-agent.service');
  const content = `[Unit]
Description=NexGuard agent (find this laptop if it is lost)
After=graphical-session.target

[Service]
ExecStart="${node}" "${cli}" run
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
`;
  return {
    files: [{ path: unit, content }],
    install: [
      { cmd: 'systemctl', args: ['--user', 'daemon-reload'] },
      { cmd: 'systemctl', args: ['--user', 'enable', '--now', 'nexguard-agent.service'] },
    ],
    uninstall: [{ cmd: 'systemctl', args: ['--user', 'disable', '--now', 'nexguard-agent.service'] }],
    removeFiles: [unit],
  };
}
