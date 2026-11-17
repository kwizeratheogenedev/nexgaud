import { EventEmitter } from 'node:events';

/**
 * Pushes each device's new positions and status to the dashboards watching it (GET /devices/:id/stream).
 * In one API process. With several processes behind a load balancer this needs a shared channel
 * (Redis or MongoDB change streams); until then, watchers on another process see changes on their next refresh.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0); // one listener per open dashboard; counted in watcherCount()

const channel = (deviceId) => `device:${deviceId}`;

export function subscribe(deviceId, listener) {
  bus.on(channel(deviceId), listener);
  return () => bus.off(channel(deviceId), listener);
}

export const watcherCount = (deviceId) => bus.listenerCount(channel(deviceId));

/** New positions, oldest first. */
export function publishLocations(device, points) {
  if (!watcherCount(device.id) || !points.length) return;
  const sorted = [...points].sort((a, b) => a.recordedAt - b.recordedAt);
  for (const p of sorted) {
    bus.emit(channel(device.id), 'location', {
      lat: p.lat,
      lng: p.lng,
      accuracyM: p.accuracyM ?? null,
      source: p.source ?? null,
      battery: p.battery ?? null,
      at: p.recordedAt,
    });
  }
}

/** The device's state: what the dashboard shows beside the map. */
export function publishState(device) {
  if (!watcherCount(device.id)) return;
  bus.emit(channel(device.id), 'state', {
    status: device.status,
    battery: device.battery ?? null,
    charging: device.charging ?? null,
    lastSeenAt: device.lastSeenAt ?? null,
    liveUntil: device.liveUntil && device.liveUntil > new Date() ? device.liveUntil : null,
  });
}
