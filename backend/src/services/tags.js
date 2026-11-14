import { Alert } from '../models/Alert.js';
import { Tag } from '../models/Tag.js';
import { User } from '../models/User.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { maskPhone } from '../lib/phone.js';
import { randomCode } from '../lib/codes.js';
import { recipientsFor } from './access.js';
import { sendSms } from './sms.js';

export const tagUrl = (code) => `${config.PUBLIC_APP_URL.replace(/\/+$/, '')}/t/${code}`;

/** A new tag code that is not taken yet (31^8 codes, so a clash is rare but checked). */
export async function newTagCode() {
  for (let i = 0; i < 5; i++) {
    const code = randomCode(8);
    if (!(await Tag.exists({ code }))) return code;
  }
  throw new Error('Could not make a unique tag code');
}

const short = (text, n = 80) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

// Kinyarwanda and French need a native speaker's review.
const OWNER_TEXTS = {
  en: {
    tag_scanned: (t) => `NexGuard: your tag "${t}" was just scanned. Open NexGuard to see if the finder wrote to you.`,
    tag_message: (t, m) => `NexGuard: someone found your "${t}" and wrote: "${short(m)}". Reply in NexGuard.`,
  },
  fr: {
    tag_scanned: (t) => `NexGuard : votre étiquette « ${t} » vient d'être scannée. Ouvrez NexGuard pour voir si la personne vous a écrit.`,
    tag_message: (t, m) => `NexGuard : quelqu'un a trouvé « ${t} » et a écrit : « ${short(m)} ». Répondez dans NexGuard.`,
  },
  rw: {
    tag_scanned: (t) => `NexGuard: ikirango cyawe "${t}" kimaze gusikanwa. Fungura NexGuard urebe niba uwakibonye yakwandikiye.`,
    tag_message: (t, m) => `NexGuard: umuntu yabonye "${t}" yandika ati: "${short(m)}". Musubize muri NexGuard.`,
  },
};

const FINDER_TEXTS = {
  en: (t, m, url) => `NexGuard: the owner of the "${t}" you found replied: "${short(m, 200)}". Answer at ${url}`,
  fr: (t, m, url) => `NexGuard : le propriétaire de « ${t} » que vous avez trouvé a répondu : « ${short(m, 200)} ». Répondez sur ${url}`,
  rw: (t, m, url) => `NexGuard: nyiri "${t}" wabonye yagusubije ati: "${short(m, 200)}". Musubize kuri ${url}`,
};

const tagLabel = (tag) => tag.name ?? 'NexGuard tag';

/**
 * Alerts the tag's owner, or every manager of its organisation, and texts them unless an SMS of this
 * type for this tag went out within smsCooldownMs. sms: false records the alert without texting.
 */
export async function notifyTag(tag, type, { threadId, message, sms = true, smsCooldownMs = 3600 * 1000 } = {}) {
  try {
    const recipients = await recipientsFor(tag);
    const recent =
      !sms ||
      (await Alert.exists({ tagId: tag._id, type, smsSent: true, createdAt: { $gte: new Date(Date.now() - smsCooldownMs) } }));
    for (const ownerId of recipients) {
      let smsSent = false;
      const owner = recent ? null : await User.findById(ownerId);
      if (owner) {
        try {
          await sendSms(owner.phone, (OWNER_TEXTS[owner.language] ?? OWNER_TEXTS.en)[type](tagLabel(tag), message ?? ''));
          smsSent = true;
        } catch (err) {
          logger.warn({ err: err.message, to: maskPhone(owner.phone), type }, 'Tag SMS failed');
        }
      }
      await Alert.create({ ownerId, tagId: tag._id, threadId, type, message, smsSent });
    }
  } catch (err) {
    logger.error({ err: err.message, type }, 'Tag alert failed');
  }
}

/** Texts the owner's reply to a finder who left their number. Never throws. */
export async function textFinder(thread, tag, text) {
  if (!thread.finderPhone) return false;
  try {
    const compose = FINDER_TEXTS[thread.finderLanguage] ?? FINDER_TEXTS.en;
    await sendSms(thread.finderPhone, compose(tagLabel(tag), text, tagUrl(tag.code)));
    return true;
  } catch (err) {
    logger.warn({ err: err.message, to: maskPhone(thread.finderPhone) }, 'Finder SMS failed');
    return false;
  }
}
