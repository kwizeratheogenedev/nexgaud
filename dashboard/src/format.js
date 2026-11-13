const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function timeAgo(value) {
  if (!value) return 'never';
  const sec = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const abs = Math.abs(sec);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
  return rtf.format(Math.round(sec / 86400), 'day');
}

export const dateTime = (value) =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

// A phone that has not checked in for this long is shown as offline.
export const OFFLINE_AFTER_MS = 30 * 60 * 1000;
export const isOnline = (device) =>
  device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < OFFLINE_AFTER_MS;

export const COMMAND_LABELS = { ring: 'Ring', lock: 'Lock', locate: 'Locate now', message: 'Show message' };
export const STATUS_LABELS = {
  queued: 'Waiting for the phone',
  sent: 'Delivered to the phone',
  done: 'Done',
  failed: 'Failed',
  expired: 'Expired',
};
