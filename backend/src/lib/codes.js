import { randomInt } from 'node:crypto';

// No look-alikes (0/O, 1/I/L): codes are read off screens and stickers and typed or said aloud.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const randomCode = (length = 8) =>
  Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

/** Pairing codes and tag codes: 8 characters. People may type them with spaces, dashes or in lower case. */
export const pairingCode = () => randomCode(8);
export const normalizeCode = (input) => String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
