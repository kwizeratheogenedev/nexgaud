// Locales for dates and relative times. Browsers without Kinyarwanda data fall back to English.
const LOCALES = { en: 'en', fr: 'fr', rw: 'rw' };
const rtfCache = {};

export function timeAgo(value, lang = 'en', t = (k) => k) {
  if (!value) return t('never');
  const sec = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const abs = Math.abs(sec);
  if (abs < 45) return t('justNow');
  rtfCache[lang] ??= new Intl.RelativeTimeFormat(LOCALES[lang] ?? 'en', { numeric: 'auto' });
  const rtf = rtfCache[lang];
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
  return rtf.format(Math.round(sec / 86400), 'day');
}

export const dateTime = (value, lang = 'en') =>
  value ? new Date(value).toLocaleString(LOCALES[lang] ?? 'en', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

// A phone that has not checked in for this long is shown as offline.
export const OFFLINE_AFTER_MS = 30 * 60 * 1000;
export const isOnline = (device) =>
  device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < OFFLINE_AFTER_MS;

export const isLost = (device) => ['lost', 'stolen'].includes(device?.status);

/** 2345ABCD → 2345-ABCD, easier to read and type. */
export const formatCode = (code) => (code?.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);
