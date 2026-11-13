import { createContext, useContext, useMemo, useState } from 'react';

// Dashboard texts in English, French and Kinyarwanda.
// The French and Kinyarwanda texts need a review by native speakers before launch.
// {name} placeholders are filled in by t(key, { name: ... }).
const en = {
  loading: 'Loading…',
  signOut: 'Sign out',
  language: 'Language',
  'health.loading': 'Checking service',
  'health.ok': 'Service is up',
  'health.degraded': 'Service has problems',
  'health.down': 'Service unreachable',
  'nav.devices': 'My devices',
  'nav.pilot': 'Pilot statistics',
  privacy: 'Privacy policy',
  terms: 'Terms of use',

  'login.lead': 'See where your phone is, ring it, or lock it.',
  'login.phone': 'Phone number',
  'login.phoneHint': 'Use the same number you signed in with on the NexGuard app.',
  'login.sendCode': 'Send code',
  'login.sending': 'Sending…',
  'login.codeSentTo': 'We sent a 6-digit code to {phone}.',
  'login.changeNumber': 'Change number',
  'login.code': 'Code',
  'login.name': 'Your name (only needed the first time)',
  'login.signIn': 'Sign in',
  'login.checking': 'Checking…',

  'devices.loading': 'Loading your devices…',
  'devices.emptyTitle': 'No devices yet',
  'devices.empty1': 'Install the NexGuard app on the phone you want to protect.',
  'devices.empty2': 'Sign in with this same phone number.',
  'devices.empty3': 'Follow the setup steps and allow location "all the time".',
  'devices.emptyHint': 'The phone appears here as soon as it is set up.',
  'devices.yours': 'Your devices',
  'devices.online': 'Online',
  'devices.lastSeenAgo': 'Last seen {time}',
  'devices.lostBadge': 'Lost',
  'devices.phone': 'Phone',
  'devices.noLocation': 'No location yet. It appears once the phone sends its first one.',
  'devices.lastLocation': 'Last location',
  'devices.lastSeen': 'Last seen',
  'devices.battery': 'Battery',
  'devices.charging': '(charging)',
  'devices.route': 'Route shown',
  'devices.routeValue': '{count} points, last {hours} hours',
  'devices.simChanged': 'SIM changed',
  'devices.remove': 'Remove this device',
  'devices.removeConfirm':
    'Remove "{name}"? Its location history is deleted and the phone stops being protected until it is added again.',

  'warn.location': 'Location is not set to "Allow all the time", so tracking stops when the app is closed.',
  'warn.battery': 'Battery optimisation is on for NexGuard. The phone may stop sending locations.',
  'warn.admin': 'Lock is not enabled on the phone (device admin is off).',

  'actions.title': 'Actions',
  'actions.ring': 'Ring',
  'actions.locate': 'Locate now',
  'actions.lock': 'Lock',
  'actions.messagePlaceholder': 'Message to show on the lock screen',
  'actions.show': 'Show',
  'actions.noPush':
    'Instant delivery is not set up yet, so the phone gets actions when it next sends its location (within a few minutes).',
  'actions.recent': 'Recent actions',
  'actions.none': 'No actions yet.',
  'command.ring': 'Ring',
  'command.lock': 'Lock',
  'command.locate': 'Locate now',
  'command.message': 'Show message',
  'status.queued': 'Waiting for the phone',
  'status.sent': 'Delivered to the phone',
  'status.done': 'Done',
  'status.failed': 'Failed',
  'status.expired': 'Expired',

  'lost.markLost': 'Mark as lost',
  'lost.found': 'I found it',
  'lost.title': 'This device is marked lost',
  'lost.intro':
    'The phone shows your message on its screen so an honest finder can contact you. It sends its location every minute, and its history is kept for a year.',
  'lost.formIntro':
    'The phone will show this message on its screen and send its location every minute. Its history is kept for a year instead of 30 days.',
  'lost.message': "Message on the phone's screen",
  'lost.defaultMessage': 'This phone is lost. Please call the owner.',
  'lost.contact': 'Number to call (not this phone)',
  'lost.save': 'Save changes',
  'lost.edit': 'Edit message',
  'lost.contactInvalid': 'Enter a phone number using digits only, for example 0788 123 456.',
  'lost.cancel': 'Cancel',

  'alerts.title': 'Alerts',
  'alerts.none': 'No alerts.',
  'alerts.markAllRead': 'Mark all as read',
  'alerts.smsSent': 'SMS sent',
  'alerts.open': 'Alerts ({count} unread)',
  'alert.sim_changed': 'A different SIM card was put in',
  'alert.sim_removed': 'The SIM card was removed',
  'alert.protection_off': 'Protection was turned off on the phone',
  'alert.admin_off': 'Remote lock was turned off on the phone',
  'alert.pin_failed': 'A wrong PIN was entered 5 times',
  'alert.low_battery': 'Battery low ({battery}%), last location saved',
  'alert.shutdown': 'The phone is being switched off, last location saved',

  justNow: 'just now',
  never: 'never',
};

const fr = {
  loading: 'Chargement…',
  signOut: 'Se déconnecter',
  language: 'Langue',
  'health.loading': 'Vérification du service',
  'health.ok': 'Le service fonctionne',
  'health.degraded': 'Le service a des problèmes',
  'health.down': 'Service injoignable',
  'nav.devices': 'Mes appareils',
  'nav.pilot': 'Statistiques du pilote',
  privacy: 'Politique de confidentialité',
  terms: "Conditions d'utilisation",

  'login.lead': 'Voyez où est votre téléphone, faites-le sonner ou verrouillez-le.',
  'login.phone': 'Numéro de téléphone',
  'login.phoneHint': "Utilisez le même numéro que dans l'application NexGuard.",
  'login.sendCode': 'Envoyer le code',
  'login.sending': 'Envoi…',
  'login.codeSentTo': 'Nous avons envoyé un code à 6 chiffres au {phone}.',
  'login.changeNumber': 'Changer de numéro',
  'login.code': 'Code',
  'login.name': 'Votre nom (seulement la première fois)',
  'login.signIn': 'Se connecter',
  'login.checking': 'Vérification…',

  'devices.loading': 'Chargement de vos appareils…',
  'devices.emptyTitle': "Pas encore d'appareil",
  'devices.empty1': "Installez l'application NexGuard sur le téléphone à protéger.",
  'devices.empty2': 'Connectez-vous avec ce même numéro.',
  'devices.empty3': "Suivez les étapes et autorisez la position « tout le temps ».",
  'devices.emptyHint': 'Le téléphone apparaît ici dès qu’il est configuré.',
  'devices.yours': 'Vos appareils',
  'devices.online': 'En ligne',
  'devices.lastSeenAgo': 'Vu {time}',
  'devices.lostBadge': 'Perdu',
  'devices.phone': 'Téléphone',
  'devices.noLocation': 'Pas encore de position. Elle apparaît dès que le téléphone envoie la première.',
  'devices.lastLocation': 'Dernière position',
  'devices.lastSeen': 'Vu pour la dernière fois',
  'devices.battery': 'Batterie',
  'devices.charging': '(en charge)',
  'devices.route': 'Trajet affiché',
  'devices.routeValue': '{count} points, {hours} dernières heures',
  'devices.simChanged': 'SIM changée',
  'devices.remove': 'Retirer cet appareil',
  'devices.removeConfirm':
    "Retirer « {name} » ? Son historique de positions est supprimé et le téléphone n'est plus protégé tant qu'il n'est pas ajouté à nouveau.",

  'warn.location': "La position n'est pas réglée sur « Toujours autoriser » : le suivi s'arrête quand l'application est fermée.",
  'warn.battery': "L'optimisation de la batterie est active pour NexGuard. Le téléphone peut cesser d'envoyer sa position.",
  'warn.admin': "Le verrouillage n'est pas activé sur le téléphone.",

  'actions.title': 'Actions',
  'actions.ring': 'Sonner',
  'actions.locate': 'Localiser',
  'actions.lock': 'Verrouiller',
  'actions.messagePlaceholder': "Message à afficher sur l'écran de verrouillage",
  'actions.show': 'Afficher',
  'actions.noPush':
    "L'envoi instantané n'est pas encore configuré : le téléphone reçoit les actions quand il envoie sa position (dans quelques minutes).",
  'actions.recent': 'Actions récentes',
  'actions.none': "Pas encore d'action.",
  'command.ring': 'Sonner',
  'command.lock': 'Verrouiller',
  'command.locate': 'Localiser',
  'command.message': 'Afficher un message',
  'status.queued': 'En attente du téléphone',
  'status.sent': 'Reçue par le téléphone',
  'status.done': 'Fait',
  'status.failed': 'Échec',
  'status.expired': 'Expirée',

  'lost.markLost': 'Signaler comme perdu',
  'lost.found': "Je l'ai retrouvé",
  'lost.title': 'Cet appareil est signalé perdu',
  'lost.intro':
    "Le téléphone affiche votre message pour qu'une personne honnête puisse vous contacter. Il envoie sa position chaque minute et son historique est gardé un an.",
  'lost.formIntro':
    "Le téléphone affichera ce message et enverra sa position chaque minute. Son historique sera gardé un an au lieu de 30 jours.",
  'lost.message': "Message sur l'écran du téléphone",
  'lost.defaultMessage': 'Ce téléphone est perdu. Merci d’appeler son propriétaire.',
  'lost.contact': 'Numéro à appeler (pas ce téléphone)',
  'lost.save': 'Enregistrer',
  'lost.edit': 'Modifier le message',
  'lost.contactInvalid': 'Saisissez un numéro avec des chiffres uniquement, par exemple 0788 123 456.',
  'lost.cancel': 'Annuler',

  'alerts.title': 'Alertes',
  'alerts.none': 'Aucune alerte.',
  'alerts.markAllRead': 'Tout marquer comme lu',
  'alerts.smsSent': 'SMS envoyé',
  'alerts.open': 'Alertes ({count} non lues)',
  'alert.sim_changed': 'Une autre carte SIM a été insérée',
  'alert.sim_removed': 'La carte SIM a été retirée',
  'alert.protection_off': 'La protection a été désactivée sur le téléphone',
  'alert.admin_off': 'Le verrouillage à distance a été désactivé',
  'alert.pin_failed': 'Un mauvais code PIN a été saisi 5 fois',
  'alert.low_battery': 'Batterie faible ({battery} %), dernière position enregistrée',
  'alert.shutdown': 'Le téléphone est en train d’être éteint, dernière position enregistrée',

  justNow: "à l'instant",
  never: 'jamais',
};

const rw = {
  loading: 'Tegereza…',
  signOut: 'Sohoka',
  language: 'Ururimi',
  'health.loading': 'Turimo kugenzura serivisi',
  'health.ok': 'Serivisi irakora',
  'health.degraded': 'Serivisi ifite ibibazo',
  'health.down': 'Serivisi ntiboneka',
  'nav.devices': 'Ibikoresho byanjye',
  'nav.pilot': "Imibare y'igerageza",
  privacy: "Politiki y'ibanga",
  terms: 'Amabwiriza yo gukoresha',

  'login.lead': 'Reba aho telefoni yawe iri, uyivugize cyangwa uyifunge.',
  'login.phone': 'Nimero ya telefoni',
  'login.phoneHint': 'Koresha nimero wakoresheje winjira muri porogaramu ya NexGuard.',
  'login.sendCode': 'Ohereza kode',
  'login.sending': 'Birimo koherezwa…',
  'login.codeSentTo': "Twohereje kode y'imibare 6 kuri {phone}.",
  'login.changeNumber': 'Hindura nimero',
  'login.code': 'Kode',
  'login.name': 'Izina ryawe (rikenewe ubwa mbere gusa)',
  'login.signIn': 'Injira',
  'login.checking': 'Turimo kugenzura…',

  'devices.loading': 'Turimo gushaka ibikoresho byawe…',
  'devices.emptyTitle': 'Nta gikoresho kirandikwa',
  'devices.empty1': 'Shyira porogaramu ya NexGuard kuri telefoni ushaka kurinda.',
  'devices.empty2': 'Injira ukoresheje iyi nimero ya telefoni.',
  'devices.empty3': 'Kurikiza intambwe zo gutunganya, wemere aho iri "igihe cyose".',
  'devices.emptyHint': 'Telefoni igaragara hano ikimara gutunganywa.',
  'devices.yours': 'Ibikoresho byawe',
  'devices.online': 'Iri ku murongo',
  'devices.lastSeenAgo': 'Iheruka kuboneka {time}',
  'devices.lostBadge': 'Yabuze',
  'devices.phone': 'Telefoni',
  'devices.noLocation': 'Aho iri ntiharagera. Hazagaragara telefoni imaze kohereza aho iri bwa mbere.',
  'devices.lastLocation': 'Aho iheruka kuba',
  'devices.lastSeen': 'Iheruka kuboneka',
  'devices.battery': 'Umuriro',
  'devices.charging': '(irimo gusharija)',
  'devices.route': 'Inzira igaragara',
  'devices.routeValue': 'Ahantu {count}, amasaha {hours} ashize',
  'devices.simChanged': 'SIM yahinduwe',
  'devices.remove': 'Kuraho iki gikoresho',
  'devices.removeConfirm':
    'Kuraho "{name}"? Amateka y\'aho cyagiye arasibwa, kandi telefoni ntiba ikirinzwe kugeza yongeye kongerwamo.',

  'warn.location': 'Aho iri ntibyemewe "igihe cyose", bityo gukurikirana bihagarara iyo porogaramu ifunze.',
  'warn.battery': 'Kuzigama umuriro birafunguye kuri NexGuard. Telefoni ishobora guhagarika kohereza aho iri.',
  'warn.admin': 'Gufunga uri kure ntibyafunguwe kuri telefoni.',

  'actions.title': 'Ibikorwa',
  'actions.ring': 'Vugiza',
  'actions.locate': 'Shaka aho iri ubu',
  'actions.lock': 'Funga',
  'actions.messagePlaceholder': 'Ubutumwa bwo kwerekana kuri ecran',
  'actions.show': 'Erekana',
  'actions.noPush':
    'Kohereza ako kanya ntibiratunganywa, bityo telefoni yakira ibikorwa igihe yohereje aho iri (mu minota mike).',
  'actions.recent': 'Ibikorwa biheruka',
  'actions.none': 'Nta bikorwa biraba.',
  'command.ring': 'Kuvugiza',
  'command.lock': 'Gufunga',
  'command.locate': 'Gushaka aho iri',
  'command.message': 'Kwerekana ubutumwa',
  'status.queued': 'Itegereje telefoni',
  'status.sent': 'Yageze kuri telefoni',
  'status.done': 'Byakozwe',
  'status.failed': 'Byanze',
  'status.expired': 'Igihe cyarenze',

  'lost.markLost': 'Tangaza ko yabuze',
  'lost.found': 'Narayibonye',
  'lost.title': 'Iki gikoresho cyatangajwe ko cyabuze',
  'lost.intro':
    'Telefoni yerekana ubutumwa bwawe kuri ecran kugira ngo uyitoraguye ashobore kuguhamagara. Yohereza aho iri buri munota, kandi amateka yayo abikwa umwaka wose.',
  'lost.formIntro':
    'Telefoni izerekana ubu butumwa kandi yohereze aho iri buri munota. Amateka yayo azabikwa umwaka aho kuba iminsi 30.',
  'lost.message': 'Ubutumwa kuri ecran ya telefoni',
  'lost.defaultMessage': 'Iyi telefoni yabuze. Nyamuneka hamagara nyirayo.',
  'lost.contact': 'Nimero yo guhamagara (itari iyi telefoni)',
  'lost.save': 'Bika impinduka',
  'lost.edit': 'Hindura ubutumwa',
  'lost.contactInvalid': 'Andika nimero ya telefoni ukoresheje imibare gusa, urugero 0788 123 456.',
  'lost.cancel': 'Reka',

  'alerts.title': 'Imenyesha',
  'alerts.none': 'Nta menyesha rihari.',
  'alerts.markAllRead': 'Byose nabisomye',
  'alerts.smsSent': 'SMS yoherejwe',
  'alerts.open': 'Imenyesha ({count} ritarasomwa)',
  'alert.sim_changed': 'SIM itari iyawe yashyizwemo',
  'alert.sim_removed': 'SIM yakuwemo',
  'alert.protection_off': 'Uburinzi bwahagaritswe kuri telefoni',
  'alert.admin_off': 'Gufunga uri kure byahagaritswe',
  'alert.pin_failed': 'PIN itari yo yinjijwe inshuro 5',
  'alert.low_battery': 'Umuriro ugiye gushira ({battery}%), aho iri harabitswe',
  'alert.shutdown': 'Telefoni irimo kuzimywa, aho iri harabitswe',

  justNow: 'nonaha',
  never: 'nta na rimwe',
};

export const LANGUAGES = [
  { code: 'rw', label: 'Kinyarwanda' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];
const DICTS = { en, fr, rw };
const STORAGE_KEY = 'nexguard.lang';

function initialLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (DICTS[saved]) return saved;
  } catch {
    // storage blocked: fall through
  }
  const browser = (navigator.language ?? 'en').slice(0, 2);
  return DICTS[browser] ? browser : 'en';
}

/** True when this browser has a language the person picked themselves. */
export function hasSavedLanguage() {
  try {
    return Boolean(DICTS[localStorage.getItem(STORAGE_KEY)]);
  } catch {
    return false;
  }
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(initialLanguage);

  const value = useMemo(() => {
    const dict = DICTS[lang];
    const t = (key, vars) => {
      const text = dict[key] ?? en[key] ?? key;
      return vars ? text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : text;
    };
    const setLang = (next) => {
      if (!DICTS[next]) return;
      setLangState(next);
      document.documentElement.lang = next;
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // storage blocked: the choice lasts for this visit
      }
    };
    return { lang, setLang, t };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
