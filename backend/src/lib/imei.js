/**
 * IMEI and serial number helpers for the stolen-device registry.
 * An IMEI is 15 digits; the last one is a Luhn check digit, so most typing mistakes are caught.
 * People read it by dialling *#06# or from the box, often with spaces, dashes or slashes.
 */

/** Digits only, or null if the text has letters in it (then it may be a serial number). */
function digitsOf(input) {
  const text = String(input ?? '').trim().replace(/^imei\s*[:#]?\s*/i, '');
  if (!/^[\d\s\-/.]+$/.test(text)) return null;
  return text.replace(/\D/g, '');
}

export function luhnValid(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Returns { imei } for a valid IMEI, or { error } with a reason code:
 * 'length' (not 15 digits; 16 digits is an IMEISV, which has no check digit),
 * 'checksum' (a typing mistake), 'placeholder' (all the same digit, used by cheap clones).
 */
export function parseImei(input) {
  const digits = digitsOf(input);
  if (digits === null) return { error: 'format' };
  if (digits.length === 16) return { error: 'imeisv' };
  if (digits.length !== 15) return { error: 'length' };
  if (/^(\d)\1{14}$/.test(digits)) return { error: 'placeholder' };
  if (!luhnValid(digits)) return { error: 'checksum' };
  return { imei: digits };
}

/** Serial numbers: letters and digits only, upper case, 5 to 30 characters. */
export function normalizeSerial(input) {
  const s = String(input ?? '').toUpperCase().replace(/[\s\-_/.:]/g, '');
  return /^[A-Z0-9]{5,30}$/.test(s) ? s : null;
}

/**
 * What did someone type into the check box? An IMEI if it is all digits, otherwise a serial.
 * Returns { kind: 'imei', value } | { kind: 'serial', value } | { kind: 'invalid', reason }.
 */
export function classifyQuery(input) {
  const digits = digitsOf(input);
  if (digits !== null && digits.length >= 14 && digits.length <= 17) {
    const parsed = parseImei(input);
    return parsed.imei ? { kind: 'imei', value: parsed.imei } : { kind: 'invalid', reason: parsed.error };
  }
  const serial = normalizeSerial(input);
  return serial ? { kind: 'serial', value: serial } : { kind: 'invalid', reason: 'format' };
}

/** 356938035643809 → 35693803••••809, for logs and anything shown to people who are not the owner. */
export const maskImei = (imei) => (imei?.length === 15 ? `${imei.slice(0, 8)}••••${imei.slice(-3)}` : '•••');

export const IMEI_ERRORS = {
  format: 'Enter the 15-digit IMEI (dial *#06# to see it)',
  imeisv: 'That is an IMEISV (16 digits). Enter the 15-digit IMEI shown by *#06#',
  length: 'An IMEI has exactly 15 digits',
  checksum: 'This IMEI is not valid. Check the digits for a typing mistake',
  placeholder: 'This is not a real IMEI',
};
