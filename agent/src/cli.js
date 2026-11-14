#!/usr/bin/env node
/**
 * NexGuard agent for laptops (Windows, macOS, Linux).
 *
 *   nexguard-agent pair <CODE> [--api https://api.example.com/api/v1] [--name "Office laptop"]
 *   nexguard-agent install      start with the computer (this user) and start now
 *   nexguard-agent run          run in the foreground (what autostart runs)
 *   nexguard-agent status       show the pairing and the last contact
 *   nexguard-agent uninstall    stop starting with the computer, tell the owner, forget the pairing
 *
 * Make the pairing code in the NexGuard dashboard: Devices → Add a laptop (or the organisation page).
 */
import { appendFile, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { Agent, AGENT_VERSION, callApi } from './agent.js';
import { currentPlatform, runAttempts, systemPlatform } from './platform.js';
import { autostartPlan, Store } from './store.js';

const DEFAULT_API = process.env.NEXGUARD_API_URL ?? 'http://localhost:4000/api/v1';
const platformName = currentPlatform();
if (!platformName) {
  console.error(`NexGuard agent does not support ${process.platform}.`);
  process.exit(1);
}
const store = new Store(platformName);
const logFile = path.join(store.dir, 'agent.log');

async function log(line) {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(text);
  try {
    await mkdir(store.dir, { recursive: true });
    // Keep the log small: start again after 1 MB.
    const size = await stat(logFile).then((s) => s.size).catch(() => 0);
    if (size > 1024 * 1024) await writeFile(logFile, '');
    await appendFile(logFile, `${text}\n`);
  } catch {
    // logging must never stop the agent
  }
}

function option(args, name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function pair(args) {
  const code = args.find((a) => !a.startsWith('--') && a !== option(args, 'api') && a !== option(args, 'name'));
  if (!code) throw new Error('Give the pairing code: nexguard-agent pair ABCD-2345');
  const existing = await store.load();
  if (existing?.token) throw new Error('This laptop is already paired. Run "nexguard-agent uninstall" first.');
  const apiUrl = option(args, 'api') ?? DEFAULT_API;
  const platform = systemPlatform(platformName);
  const res = await callApi(apiUrl, '/device/pair', {
    body: {
      code,
      platform: platformName,
      name: option(args, 'name'),
      hostname: platform.hostname,
      osVersion: platform.osVersion,
      appVersion: AGENT_VERSION,
    },
  });
  const secret = await store.protectToken(res.deviceToken);
  await store.save({ apiUrl, deviceId: res.device.id, name: res.device.name, org: res.org?.name ?? null, pairedAt: new Date().toISOString(), ...secret });
  console.log(`Paired as "${res.device.name}"${res.org ? `, managed by ${res.org.name}` : ''}.`);
  console.log('Next: run "nexguard-agent install" so it starts with the computer.');
}

async function loadPaired() {
  const config = await store.load();
  if (!config?.token) throw new Error('Not paired yet. Run "nexguard-agent pair <CODE>" first.');
  return { config, token: await store.readToken(config) };
}

/** Only one agent at a time per user. */
async function singleInstance() {
  const lock = path.join(store.dir, 'agent.pid');
  try {
    const pid = Number(await readFile(lock, 'utf8'));
    if (pid && pid !== process.pid) {
      process.kill(pid, 0); // throws if that process is gone
      throw new Error(`The agent is already running (process ${pid}).`);
    }
  } catch (err) {
    if (err.message.startsWith('The agent is already running')) throw err;
  }
  await writeFile(lock, String(process.pid));
  const cleanup = () => rm(lock, { force: true }).finally(() => process.exit(0));
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

async function run() {
  const { config, token } = await loadPaired();
  await singleInstance();
  const platform = systemPlatform(platformName, log);
  // Nobody is tracked without knowing: an organisation laptop says who manages it, the first time it runs.
  if (config.org && !config.noticeShownAt) {
    await platform
      .message(`This laptop is managed by ${config.org} with NexGuard. They can see its location and ring or lock it if it is lost.`)
      .catch(() => {});
    await store.update({ noticeShownAt: new Date().toISOString() });
  }
  await log(`NexGuard agent ${AGENT_VERSION} protecting "${config.name}"${config.org ? ` for ${config.org}` : ''} (${platformName}).`);
  const agent = new Agent({
    apiUrl: config.apiUrl,
    token,
    platform,
    log,
    onState: (state) => store.update({ lastContactAt: new Date().toISOString(), status: state.status }).catch(() => {}),
  });
  await agent.loop();
}

async function runPlan(steps) {
  for (const step of steps) await runAttempts([step]).catch((err) => console.warn(`  ${step.cmd}: ${err.message}`));
}

function plan() {
  return autostartPlan(platformName, {
    node: process.execPath,
    cli: fileURLToPath(import.meta.url),
    dir: store.dir,
    home: os.homedir(),
  });
}

async function install() {
  await loadPaired();
  const p = plan();
  for (const f of p.files) {
    await mkdir(path.dirname(f.path), { recursive: true });
    await writeFile(f.path, f.content);
  }
  await runPlan(p.install);
  console.log('The agent now starts when you sign in to this computer, and is running.');
}

async function uninstall() {
  const config = await store.load();
  if (config?.token) {
    // Tell the owner, as the Android app does when protection is turned off.
    const token = await store.readToken(config).catch(() => null);
    if (token) await callApi(config.apiUrl, '/device/events', { token, body: { type: 'protection_off' } }).catch(() => {});
  }
  const p = plan();
  await runPlan(p.uninstall);
  for (const f of p.removeFiles ?? []) await rm(f, { force: true });
  await store.remove();
  console.log('NexGuard agent removed from this computer. Remove the laptop in the dashboard too.');
}

async function status() {
  const config = await store.load();
  if (!config?.token) return console.log('Not paired.');
  console.log(`Paired as "${config.name}"${config.org ? ` (managed by ${config.org})` : ''}`);
  console.log(`API: ${config.apiUrl}`);
  console.log(`Token stored: ${config.tokenProtection === 'dpapi' ? 'encrypted for this Windows user' : 'in a file only this user can read'}`);
  console.log(`Last contact: ${config.lastContactAt ?? 'never'}${config.status ? ` (status: ${config.status})` : ''}`);
  const fh = await open(logFile).catch(() => null);
  if (fh) {
    await fh.close();
    console.log(`Log: ${logFile}`);
  }
}

const [command, ...args] = process.argv.slice(2);
const commands = { pair: () => pair(args), run, install, uninstall, status };

if (!commands[command]) {
  console.log('Usage: nexguard-agent pair <CODE> [--api URL] [--name NAME] | install | run | status | uninstall');
  process.exit(command ? 1 : 0);
}
commands[command]().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
