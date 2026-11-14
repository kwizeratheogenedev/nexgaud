import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor, parseGeoclue, parseMacBattery, parseWindowsBattery, parseWindowsLocation } from '../src/platform.js';
import { autostartPlan, configDir } from '../src/store.js';

const NASTY = 'Return it"; rm -rf ~ & del C:\\ $(reboot) `x`';

test('each system has lock, ring and message actions', () => {
  for (const os of ['windows', 'macos', 'linux']) {
    const a = actionsFor(os);
    assert.ok(a.lock().length > 0, `${os} lock`);
    assert.ok(a.ring(30).length > 0, `${os} ring`);
    assert.ok(a.message('hi').length > 0, `${os} message`);
  }
  assert.equal(actionsFor('windows').lock()[0].args[0], 'user32.dll,LockWorkStation');
  assert.equal(actionsFor('linux').lock()[0].cmd, 'loginctl');
  assert.deepEqual(actionsFor('macos').location(), []);
  assert.throws(() => actionsFor('beos'));
});

test('message text is never part of a script: it goes as an argument or environment variable', () => {
  const win = actionsFor('windows').message(NASTY)[0];
  assert.equal(win.env.NG_TEXT, NASTY);
  assert.ok(win.args.every((arg) => !arg.includes('rm -rf')));
  const mac = actionsFor('macos').message(NASTY)[0];
  assert.equal(mac.args.at(-1), NASTY);
  assert.ok(mac.args.slice(0, -1).every((arg) => !arg.includes('rm -rf')));
  for (const spec of actionsFor('linux').message(NASTY)) {
    assert.notEqual(spec.cmd, '/bin/sh');
  }
  const ring = actionsFor('linux').ring(45)[0];
  assert.equal(ring.env.NG_SECONDS, '45');
  assert.match(ring.args[1], /\$NG_SECONDS/);
});

test('parsing locations and batteries', () => {
  assert.deepEqual(parseWindowsLocation('-1.9441,30.0619,40\r\n'), { lat: -1.9441, lng: 30.0619, accuracyM: 40, source: 'network' });
  assert.equal(parseWindowsLocation('denied'), null);
  assert.equal(parseWindowsLocation('unknown'), null);
  const geoclue = 'Client object: /org/freedesktop/GeoClue2/Client/1\n\nNew location:\nLatitude:    -1.950000°\nLongitude:   30.060000°\nAccuracy:    25.000000 meters\n';
  assert.deepEqual(parseGeoclue(geoclue), { lat: -1.95, lng: 30.06, accuracyM: 25, source: 'wifi' });
  assert.deepEqual(parseWindowsBattery('87,2'), { battery: 87, charging: true });
  assert.deepEqual(parseWindowsBattery('41,1'), { battery: 41, charging: false });
  assert.equal(parseWindowsBattery('none'), null);
  assert.deepEqual(parseMacBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)	64%; discharging; 3:10 remaining"), { battery: 64, charging: false });
  assert.deepEqual(parseMacBattery(' -InternalBattery-0	100%; charged; 0:00 remaining'), { battery: 100, charging: true });
});

test('starting with the computer: per user, on all three systems', () => {
  const opts = { node: '/usr/bin/node', cli: '/opt/nexguard/src/cli.js', dir: '/home/a/.config/nexguard', home: '/home/a' };
  const win = autostartPlan('windows', { ...opts, node: 'C:\\Program Files\\nodejs\\node.exe', cli: 'C:\\nexguard\\src\\cli.js', dir: 'C:\\Users\\a\\AppData\\Roaming\\NexGuard' });
  assert.ok(win.install[0].args.includes('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'));
  assert.match(win.files[0].content, /""C:\\Program Files\\nodejs\\node.exe"" ""C:\\nexguard\\src\\cli.js"" run", 0, False/);
  const mac = autostartPlan('macos', opts);
  assert.match(mac.files[0].path, /LaunchAgents\/rw\.nexera\.nexguard\.agent\.plist$/);
  assert.match(mac.files[0].content, /<string>\/opt\/nexguard\/src\/cli\.js<\/string><string>run<\/string>/);
  const linux = autostartPlan('linux', opts);
  assert.match(linux.files[0].path, /systemd\/user\/nexguard-agent\.service$/);
  assert.deepEqual(linux.install.at(-1).args, ['--user', 'enable', '--now', 'nexguard-agent.service']);
});

test('settings folder per system', () => {
  assert.match(configDir('windows', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a'), /Roaming[\\/]NexGuard$/);
  assert.match(configDir('macos', {}, '/Users/a'), /Library[\\/]Application Support[\\/]NexGuard$/);
  assert.match(configDir('linux', {}, '/home/a'), /\.config[\\/]nexguard$/);
  assert.equal(configDir('linux', { NEXGUARD_AGENT_HOME: '/tmp/x' }), '/tmp/x');
});
