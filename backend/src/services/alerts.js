import { Alert } from '../models/Alert.js';
import { User } from '../models/User.js';
import { logger } from '../logger.js';
import { maskPhone } from '../lib/phone.js';
import { sendSms } from './sms.js';
import { recipientsFor } from './access.js';

// The same alert type for the same device sends at most one SMS per hour (SMS costs money).
const SMS_COOLDOWN_MS = 60 * 60 * 1000;

// Always worth an SMS: someone may be tampering with the phone.
const ALWAYS_SMS = new Set(['sim_changed', 'sim_removed', 'protection_off', 'admin_off', 'pin_failed']);
// Only worth an SMS while the device is marked lost or stolen.
const SMS_WHEN_LOST = new Set(['low_battery', 'shutdown']);

// SMS texts. Kinyarwanda and French need a review by a native speaker before launch.
const TEXTS = {
  en: {
    sim_changed: (d) => `NexGuard: a different SIM card was put in "${d}". Open NexGuard to see where it is.`,
    sim_removed: (d) => `NexGuard: the SIM card was removed from "${d}".`,
    protection_off: (d) => `NexGuard: protection was turned off on "${d}".`,
    admin_off: (d) => `NexGuard: remote lock was turned off on "${d}".`,
    pin_failed: (d) => `NexGuard: someone entered a wrong PIN 5 times on "${d}".`,
    low_battery: (d, b) => `NexGuard: "${d}" battery is at ${b ?? '?'}%. Its last location was saved.`,
    shutdown: (d) => `NexGuard: "${d}" is being switched off. Its last location was saved.`,
  },
  fr: {
    sim_changed: (d) => `NexGuard : une autre carte SIM a été insérée dans « ${d} ». Ouvrez NexGuard pour voir où il se trouve.`,
    sim_removed: (d) => `NexGuard : la carte SIM a été retirée de « ${d} ».`,
    protection_off: (d) => `NexGuard : la protection a été désactivée sur « ${d} ».`,
    admin_off: (d) => `NexGuard : le verrouillage à distance a été désactivé sur « ${d} ».`,
    pin_failed: (d) => `NexGuard : quelqu'un a saisi un mauvais code PIN 5 fois sur « ${d} ».`,
    low_battery: (d, b) => `NexGuard : la batterie de « ${d} » est à ${b ?? '?'} %. Sa dernière position a été enregistrée.`,
    shutdown: (d) => `NexGuard : « ${d} » est en train d'être éteint. Sa dernière position a été enregistrée.`,
  },
  rw: {
    sim_changed: (d) => `NexGuard: SIM itari iyawe yashyizwe muri "${d}". Fungura NexGuard urebe aho iri.`,
    sim_removed: (d) => `NexGuard: SIM yakuwe muri "${d}".`,
    protection_off: (d) => `NexGuard: uburinzi bwahagaritswe kuri "${d}".`,
    admin_off: (d) => `NexGuard: gufunga telefoni uri kure byahagaritswe kuri "${d}".`,
    pin_failed: (d) => `NexGuard: umuntu yinjije PIN itari yo inshuro 5 kuri "${d}".`,
    low_battery: (d, b) => `NexGuard: umuriro wa "${d}" usigaye ${b ?? '?'}%. Aho iheruka kuba harabitswe.`,
    shutdown: (d) => `NexGuard: "${d}" iri kuzimywa. Aho iheruka kuba harabitswe.`,
  },
};

export function alertText(type, language, deviceName, battery) {
  const texts = TEXTS[language] ?? TEXTS.en;
  return texts[type](deviceName, battery);
}

/**
 * Records an alert for the device's owner and texts them when it matters.
 * Never throws: an SMS failure must not break the phone's request.
 */
export async function raiseAlert(device, type, { battery, location } = {}) {
  const lost = ['lost', 'stolen'].includes(device.status);
  const wantsSms = ALWAYS_SMS.has(type) || (lost && SMS_WHEN_LOST.has(type));
  // Organisation laptops alert every manager of the organisation.
  const recipients = await recipientsFor(device);

  let smsAllowed = false;
  if (wantsSms) {
    smsAllowed = !(await Alert.exists({
      deviceId: device._id,
      type,
      smsSent: true,
      createdAt: { $gte: new Date(Date.now() - SMS_COOLDOWN_MS) },
    }));
  }

  const alerts = [];
  for (const ownerId of recipients) {
    let smsSent = false;
    const owner = smsAllowed ? await User.findById(ownerId) : null;
    if (owner) {
      try {
        await sendSms(owner.phone, alertText(type, owner.language, device.name, battery));
        smsSent = true;
      } catch (err) {
        logger.warn({ err: err.message, to: maskPhone(owner.phone), type }, 'Alert SMS failed');
      }
    }
    alerts.push(await Alert.create({ ownerId, deviceId: device._id, type, battery, location, smsSent }));
  }
  return alerts[0] ?? new Alert({ ownerId: device.ownerId, deviceId: device._id, type, battery, location });
}
