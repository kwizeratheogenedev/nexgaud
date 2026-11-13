import { config } from '../config.js';

/**
 * Turns what people type into E.164 (+250788123456).
 * Accepts +250788123456, 250788123456, 0788123456, spaces and dashes.
 * Returns null when it cannot be a valid number.
 */
export function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let digits = input.trim().replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = config.DEFAULT_COUNTRY_CODE + digits.slice(1);
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}

export function maskPhone(phone) {
  return phone.length > 6 ? `${phone.slice(0, 4)}•••${phone.slice(-3)}` : '•••';
}
