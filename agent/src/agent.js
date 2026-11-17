/**
 * The agent's work: check in with the NexGuard API, run the owner's commands (ring, lock,
 * show a message, locate), send locations, and show the lost-mode message when the laptop is lost.
 * It uses the same device API as the Android app.
 */
export const AGENT_VERSION = '0.4.0';

export const INTERVALS = {
  checkIn: 2 * 60 * 1000, // laptops have no push service: commands arrive within 2 minutes
  checkInLost: 60 * 1000,
  location: 15 * 60 * 1000,
  locationLost: 2 * 60 * 1000,
  // Live tracking (the owner asked, for a few minutes): check in and send the location every 10 seconds.
  live: 10 * 1000,
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message ?? `NexGuard API answered ${status}`);
    this.status = status;
    this.code = body?.error;
  }
}

export async function callApi(apiUrl, path, { token, body, method } = {}) {
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(token ? { Authorization: `Device ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'User-Agent': `NexGuardAgent/${AGENT_VERSION}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export class Agent {
  /**
   * platform: { name, osVersion, lock(), ring(seconds), message(text), location(), battery(), locationSupported }
   * onState: called after each check-in with the latest state (for saving lastContactAt).
   */
  constructor({ apiUrl, token, platform, log = () => {}, onState = () => {}, now = () => Date.now() }) {
    Object.assign(this, { apiUrl, token, platform, log, onState, now });
    this.handled = new Set(); // commands already run (the API repeats them until acknowledged)
    this.lastLocationAt = 0;
    this.lostShownSince = null;
    this.status = 'normal';
    this.liveUntil = 0;
  }

  api(path, body) {
    return callApi(this.apiUrl, path, { token: this.token, body });
  }

  get lost() {
    return ['lost', 'stolen'].includes(this.status);
  }

  get live() {
    return this.liveUntil > this.now();
  }

  /** One round: check in, act on the reply, send a location if one is due. */
  async tick() {
    const power = await this.platform.battery().catch(() => null);
    const state = await this.api('/device/heartbeat', {
      ...(power ? { battery: power.battery, charging: power.charging } : {}),
      network: 'other',
      appVersion: AGENT_VERSION,
      osVersion: this.platform.osVersion,
      permissions: { location: this.platform.locationSupported ? 'always' : 'denied', notifications: true },
    });
    await this.handleState(state);

    const every = this.live ? INTERVALS.live : this.lost ? INTERVALS.locationLost : INTERVALS.location;
    if (this.platform.locationSupported && this.now() - this.lastLocationAt >= every) await this.sendLocation();
  }

  async sendLocation() {
    this.lastLocationAt = this.now();
    const point = await this.platform.location().catch(() => null);
    if (!point) return false;
    const power = await this.platform.battery().catch(() => null);
    const state = await this.api('/device/locations', {
      points: [{ ...point, ...(power ? { battery: power.battery } : {}), recordedAt: new Date(this.now()).toISOString() }],
    });
    await this.handleState(state);
    return true;
  }

  async handleState(state) {
    this.status = state.status ?? 'normal';
    const wasLive = this.live;
    this.liveUntil = state.liveUntil ? new Date(state.liveUntil).getTime() : 0;
    if (this.live !== wasLive) this.log(this.live ? 'Live tracking on: sending the location every 10 seconds' : 'Live tracking off');
    this.onState(state);

    // Lost mode: show the owner's message once each time the laptop is marked lost.
    const lostMode = state.lostMode;
    if (lostMode && this.lostShownSince !== lostMode.since) {
      this.lostShownSince = lostMode.since;
      const text = [lostMode.message ?? 'This laptop is lost. Please return it to its owner.', lostMode.contactPhone ? `Call: ${lostMode.contactPhone}` : null]
        .filter(Boolean)
        .join('\n');
      await this.platform.message(text).catch((err) => this.log(`Could not show the lost message: ${err.message}`));
    }
    if (!lostMode) this.lostShownSince = null;

    for (const command of state.commands ?? []) {
      if (this.handled.has(command.id)) continue;
      this.handled.add(command.id);
      // Commands repeat in every reply until acknowledged (also in the reply to a location upload).
      await this.run(command);
    }
  }

  async run(command) {
    let status = 'done';
    let result;
    try {
      result = await this.execute(command);
    } catch (err) {
      status = 'failed';
      result = `Failed: ${err.message}`.slice(0, 300);
    }
    this.log(`Command ${command.type}: ${status}${result ? ` (${result})` : ''}`);
    await this.api(`/device/commands/${command.id}/ack`, { status, result }).catch((err) => this.log(`Ack failed: ${err.message}`));
  }

  async execute(command) {
    const payload = command.payload ?? {};
    switch (command.type) {
      case 'ring': {
        const seconds = payload.durationSec ?? 30;
        await this.platform.ring(seconds);
        return `Rang for ${seconds} seconds`;
      }
      case 'lock':
        await this.platform.lock();
        return 'Screen locked';
      case 'message': {
        const text = [payload.message, payload.contactPhone ? `Call: ${payload.contactPhone}` : null].filter(Boolean).join('\n');
        await this.platform.message(text);
        return 'Message shown';
      }
      case 'locate': {
        if (!this.platform.locationSupported) throw new Error(`location is not available on ${this.platform.name}`);
        const sent = await this.sendLocation();
        if (!sent) throw new Error('no location (is Windows location turned on?)');
        return 'Sent a fresh location';
      }
      default:
        throw new Error(`unknown command ${command.type}`);
    }
  }

  /** Runs until stop() is called. Network errors only delay the next round. */
  async loop() {
    this.stopped = false;
    while (!this.stopped) {
      try {
        await this.tick();
      } catch (err) {
        if (err.status === 401) {
          this.log('This laptop was removed from NexGuard. Pair it again to protect it.');
          throw err;
        }
        this.log(`Check-in failed: ${err.message}`);
      }
      await new Promise((resolve) => {
        this.wake = resolve;
        setTimeout(resolve, this.live ? INTERVALS.live : this.lost ? INTERVALS.checkInLost : INTERVALS.checkIn);
      });
    }
  }

  stop() {
    this.stopped = true;
    this.wake?.();
  }
}
