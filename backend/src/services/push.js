import { config } from '../config.js';
import { logger } from '../logger.js';

let messagingPromise = null;

// firebase-admin is loaded only when a service account is configured.
async function messaging() {
  if (!config.FIREBASE_SERVICE_ACCOUNT_B64) return null;
  messagingPromise ??= (async () => {
    const { initializeApp, cert } = await import('firebase-admin/app');
    const { getMessaging } = await import('firebase-admin/messaging');
    const account = JSON.parse(Buffer.from(config.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'));
    return getMessaging(initializeApp({ credential: cert(account) }));
  })().catch((err) => {
    logger.error({ err: err.message }, 'Firebase could not start; push is off');
    return null;
  });
  return messagingPromise;
}

export const pushEnabled = () => Boolean(config.FIREBASE_SERVICE_ACCOUNT_B64);

/**
 * Wakes the phone so it fetches its pending commands right away.
 * The message carries no command details: the phone always asks the API.
 * Returns true when the push was accepted by Firebase.
 */
export async function wakeDevice(device) {
  if (!device.pushToken) return false;
  const fcm = await messaging();
  if (!fcm) return false;
  try {
    await fcm.send({
      token: device.pushToken,
      data: { kind: 'commands_pending' },
      android: { priority: 'high', ttl: 3600 * 1000 },
    });
    return true;
  } catch (err) {
    logger.warn({ err: err.message, deviceId: device.id }, 'Push failed');
    return false;
  }
}
