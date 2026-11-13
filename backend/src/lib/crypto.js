import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

// Keyed hash: a database leak alone does not reveal sign-in codes or device tokens.
export function hmac(value) {
  return createHmac('sha256', config.hashSecret).update(String(value)).digest('hex');
}

export function safeEqualHex(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sixDigitCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
