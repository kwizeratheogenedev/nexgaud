import { config } from '../config.js';
import { logger } from '../logger.js';
import { maskPhone } from '../lib/phone.js';

// Codes sent through the console provider, kept for tests and local development only.
export const devOutbox = [];

async function sendConsole(to, message) {
  devOutbox.push({ to, message, at: new Date() });
  if (devOutbox.length > 50) devOutbox.shift();
  logger.info({ to: maskPhone(to) }, `[dev SMS] ${message}`);
}

// Africa's Talking bulk SMS API. https://developers.africastalking.com/docs/sms/sending
async function sendAfricasTalking(to, message) {
  const sandbox = config.AT_USERNAME === 'sandbox';
  const url = sandbox
    ? 'https://api.sandbox.africastalking.com/version1/messaging'
    : 'https://api.africastalking.com/version1/messaging';
  const body = new URLSearchParams({ username: config.AT_USERNAME ?? '', to, message });
  if (config.AT_SENDER_ID) body.set('from', config.AT_SENDER_ID);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apiKey: config.AT_API_KEY ?? '',
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`SMS provider returned ${res.status}`);
  }
  const data = await res.json().catch(() => ({}));
  const status = data?.SMSMessageData?.Recipients?.[0]?.status;
  if (status && status !== 'Success') throw new Error(`SMS not sent: ${status}`);
}

export async function sendSms(to, message) {
  if (config.SMS_PROVIDER === 'africastalking') return sendAfricasTalking(to, message);
  return sendConsole(to, message);
}
