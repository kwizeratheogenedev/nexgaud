import { RegistryItem } from '../models/RegistryItem.js';
import { TheftReport } from '../models/TheftReport.js';
import { CheckLog } from '../models/CheckLog.js';
import { Alert } from '../models/Alert.js';
import { User } from '../models/User.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { hmac } from '../lib/crypto.js';
import { classifyQuery, IMEI_ERRORS, maskImei } from '../lib/imei.js';
import { maskPhone } from '../lib/phone.js';
import { sendSms } from './sms.js';

// An owner hears about checks of their stolen phone by SMS at most once a day (every check is still an alert).
const CHECK_SMS_COOLDOWN_MS = 24 * 3600 * 1000;
const RESULT_RANK = { stolen: 3, lost: 2, registered: 1 };

/** Finds registry items by IMEI or serial. A serial can match more than one brand. */
export async function findItems(parsed) {
  if (parsed.kind === 'imei') return RegistryItem.find({ imeis: parsed.value }).limit(1);
  if (parsed.kind === 'serial') return RegistryItem.find({ serial: parsed.value }).limit(5);
  return [];
}

/** The item a check is about: the one with the most serious status. */
const pickItem = (items) => items.sort((a, b) => RESULT_RANK[b.status] - RESULT_RANK[a.status])[0] ?? null;

export const openReportFor = (itemId) =>
  TheftReport.findOne({ itemId, status: { $in: ['pending', 'approved'] } }).sort({ createdAt: -1 });

/** What anyone may learn from a check: the device's make and model and whether it is reported. Never the owner. */
function publicView(parsed, item, report, { police = false } = {}) {
  if (parsed.kind === 'invalid') {
    return { kind: 'invalid', result: 'invalid', reason: parsed.reason, message: IMEI_ERRORS[parsed.reason] };
  }
  const base = { kind: parsed.kind, display: parsed.kind === 'imei' ? maskImei(parsed.value) : parsed.value };
  if (!item) return { ...base, result: 'not_registered', device: null };
  // Only an approved report changes the item's status; a pending one is not shown to the public yet.
  const reported = item.status !== 'registered';
  return {
    ...base,
    result: reported ? item.status : 'registered',
    device: { kind: item.kind, brand: item.brand, model: item.model ?? null, color: item.color ?? null },
    reportedOn: reported && report ? (report.reviewedAt ?? report.createdAt).toISOString().slice(0, 10) : null,
    // The police see the case they can follow up; nobody else sees report details.
    ...(police && reported && report
      ? { police: { caseNumber: report.policeCaseNumber ?? null, station: report.policeStation ?? null, place: report.place } }
      : {}),
  };
}

/**
 * Runs one check, logs it, and tells the owner when someone checks a device they reported.
 * source: web | ussd | sms | partner_portal | partner_api. requester: an IP or phone (only its hash is kept).
 */
export async function runCheck(input, { source, partner, user, requester } = {}) {
  const parsed = classifyQuery(input);
  const item = pickItem(await findItems(parsed));
  const report = item ? await openReportFor(item._id) : null;
  const view = publicView(parsed, item, report, { police: partner?.type === 'police' });

  await CheckLog.create({
    source,
    queryKind: parsed.kind,
    result: view.result,
    itemId: item?._id,
    partnerId: partner?._id,
    userId: user?._id,
    requesterHash: requester ? hmac(`check:${requester}`) : undefined,
  });

  // A pending report counts too: the owner wants to know even before the team has approved it.
  if (item && report) {
    const where = partner ? partner.name : { web: 'web', ussd: 'USSD', sms: 'SMS' }[source] ?? source;
    await notifyOwner(item, 'registry_check', { source: where, smsCooldownMs: CHECK_SMS_COOLDOWN_MS });
  }
  return view;
}

// SMS to owners about their registered devices. Kinyarwanda and French need a native speaker's review.
const OWNER_TEXTS = {
  en: {
    registry_check: (d, x) => `NexGuard: someone checked your reported "${d}" (${x.source}). Contact the police with your case number.`,
    registry_tip: (d) => `NexGuard: someone says they have seen your "${d}". Open NexGuard to read the message.`,
    report_approved: (d) => `NexGuard: your report for "${d}" was approved. Anyone who checks it now sees it is reported.`,
    report_rejected: (d) => `NexGuard: your report for "${d}" was not approved. Open NexGuard to see why.`,
    dispute_resolved: (d) => `NexGuard: a decision was made about "${d}". Open NexGuard to see it.`,
    item_transferred: (d) => `NexGuard: "${d}" is now registered to its new owner.`,
  },
  fr: {
    registry_check: (d, x) => `NexGuard : quelqu'un a vérifié « ${d} » que vous avez signalé (${x.source}). Contactez la police avec votre numéro de dossier.`,
    registry_tip: (d) => `NexGuard : quelqu'un dit avoir vu « ${d} ». Ouvrez NexGuard pour lire le message.`,
    report_approved: (d) => `NexGuard : votre signalement pour « ${d} » a été accepté. Toute vérification le montre maintenant comme signalé.`,
    report_rejected: (d) => `NexGuard : votre signalement pour « ${d} » n'a pas été accepté. Ouvrez NexGuard pour voir pourquoi.`,
    dispute_resolved: (d) => `NexGuard : une décision a été prise au sujet de « ${d} ». Ouvrez NexGuard pour la voir.`,
    item_transferred: (d) => `NexGuard : « ${d} » est maintenant enregistré au nom de son nouveau propriétaire.`,
  },
  rw: {
    registry_check: (d, x) => `NexGuard: umuntu yagenzuye "${d}" wamenyekanishije (${x.source}). Vugana na polisi ukoresheje nimero ya dosiye yawe.`,
    registry_tip: (d) => `NexGuard: umuntu avuga ko yabonye "${d}". Fungura NexGuard usome ubutumwa.`,
    report_approved: (d) => `NexGuard: ibyo wamenyekanishije kuri "${d}" byemejwe. Uyigenzura wese abona ko yamenyekanishijwe.`,
    report_rejected: (d) => `NexGuard: ibyo wamenyekanishije kuri "${d}" ntibyemejwe. Fungura NexGuard urebe impamvu.`,
    dispute_resolved: (d) => `NexGuard: hafashwe icyemezo kuri "${d}". Fungura NexGuard ukirebe.`,
    item_transferred: (d) => `NexGuard: "${d}" ubu yanditswe kuri nyirayo mushya.`,
  },
};

export function ownerText(type, language, label, extra = {}) {
  return (OWNER_TEXTS[language] ?? OWNER_TEXTS.en)[type](label, extra);
}

/**
 * Records a registry alert for a user (by default the item's owner) and texts them.
 * smsCooldownMs: skip the SMS if one of this type for this item went out within that time.
 */
export async function notifyOwner(item, type, { userId, source, message, contactPhone, smsCooldownMs = 0, label } = {}) {
  const ownerId = userId ?? item.ownerId;
  let smsSent = false;
  try {
    const recent =
      smsCooldownMs > 0 &&
      (await Alert.exists({ ownerId, itemId: item._id, type, smsSent: true, createdAt: { $gte: new Date(Date.now() - smsCooldownMs) } }));
    const owner = recent ? null : await User.findById(ownerId);
    if (owner) {
      try {
        await sendSms(owner.phone, ownerText(type, owner.language, label ?? item.label(), { source }));
        smsSent = true;
      } catch (err) {
        logger.warn({ err: err.message, to: maskPhone(owner.phone), type }, 'Registry SMS failed');
      }
    }
    return await Alert.create({ ownerId, itemId: item._id, type, source, message, contactPhone, smsSent });
  } catch (err) {
    logger.error({ err: err.message, type }, 'Registry alert failed');
    return null;
  }
}

// Replies for USSD and SMS checks. Kept short: USSD screens show about 160 characters.
const CHECK_TEXTS = {
  en: {
    stolen: (v) => `REPORTED STOLEN: ${v.device}. Do not buy it. If you have it, take it to the police.`,
    lost: (v) => `REPORTED LOST: ${v.device}. Do not buy it. Help it get back to its owner via the police.`,
    registered: (v) => `${v.device}: registered, not reported stolen. Still ask the seller for the box or receipt.`,
    not_registered: () => 'Not in the NexGuard registry. This does not prove it is safe: ask for the box or receipt.',
    invalid: () => 'Not a valid IMEI. Dial *#06# on the phone to see its 15-digit IMEI.',
    smsHelp: () => 'To check a phone, send: CHECK followed by the 15-digit IMEI (dial *#06# to see it).',
  },
  fr: {
    stolen: (v) => `SIGNALÉ VOLÉ : ${v.device}. Ne l'achetez pas. Si vous l'avez, apportez-le à la police.`,
    lost: (v) => `SIGNALÉ PERDU : ${v.device}. Ne l'achetez pas. Aidez à le rendre via la police.`,
    registered: (v) => `${v.device} : enregistré, non signalé volé. Demandez quand même la boîte ou le reçu.`,
    not_registered: () => "Absent du registre NexGuard. Cela ne prouve rien : demandez la boîte ou le reçu.",
    invalid: () => "IMEI non valide. Composez *#06# sur le téléphone pour voir son IMEI à 15 chiffres.",
    smsHelp: () => 'Pour vérifier un téléphone, envoyez : VERIFIER suivi de l\'IMEI à 15 chiffres (composez *#06#).',
  },
  rw: {
    stolen: (v) => `YARIBWE: ${v.device}. Ntuyigure. Niba uyifite, yishyikirize polisi.`,
    lost: (v) => `YARABUZE: ${v.device}. Ntuyigure. Fasha kuyisubiza nyirayo unyuze kuri polisi.`,
    registered: (v) => `${v.device}: yanditswe, ntiyamenyekanishijwe ko yibwe. Saba ugurisha agasanduku cyangwa inyemezabuguzi.`,
    not_registered: () => 'Ntiri mu bubiko bwa NexGuard. Ibi ntibyemeza ko ari nziza: saba agasanduku cyangwa inyemezabuguzi.',
    invalid: () => 'IMEI ntabwo ari yo. Kanda *#06# kuri telefoni urebe IMEI yayo y\'imibare 15.',
    smsHelp: () => 'Kugira ngo ugenzure telefoni, ohereza: REBA ukurikizeho IMEI y\'imibare 15 (kanda *#06#).',
  },
};

export function checkText(view, language) {
  const texts = CHECK_TEXTS[language] ?? CHECK_TEXTS.en;
  const device = view.device ? [view.device.brand, view.device.model].filter(Boolean).join(' ') : '';
  return texts[view.result]({ device });
}

export const smsHelpText = (language) => (CHECK_TEXTS[language] ?? CHECK_TEXTS.en).smsHelp();

export const checkPageUrl = () => config.PUBLIC_CHECK_URL ?? null;
