import { useCallback, useEffect, useRef, useState } from 'react';
import { getHealth, listAlerts, markAlertsRead, refreshSession, setSignedOutHandler, signOut, updateMe } from './api.js';
import { hasSavedLanguage, useI18n } from './i18n.jsx';
import LanguagePicker from './components/LanguagePicker.jsx';
import { timeAgo } from './format.js';
import { usePolling } from './usePolling.js';
import Login from './pages/Login.jsx';
import Devices from './pages/Devices.jsx';
import PilotStats from './pages/PilotStats.jsx';
import Registry from './pages/Registry.jsx';
import PartnerPortal from './pages/PartnerPortal.jsx';
import AdminRegistry from './pages/AdminRegistry.jsx';
import Tags from './pages/Tags.jsx';
import OrgPage from './pages/OrgPage.jsx';
import TagsAdmin from './pages/TagsAdmin.jsx';
import Billing from './pages/Billing.jsx';
import BillingAdmin from './pages/BillingAdmin.jsx';

function HealthDot() {
  const { t } = useI18n();
  const [state, setState] = useState('loading');
  useEffect(() => {
    let alive = true;
    const check = () =>
      getHealth()
        .then((h) => alive && setState(h.status === 'ok' ? 'ok' : 'degraded'))
        .catch(() => alive && setState('down'));
    check();
    const id = setInterval(check, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  const label = t(`health.${state}`);
  return <span className={`dot dot-${state}`} title={label} aria-label={label} role="img" />;
}

function AlertsMenu({ alerts, unread, devices, onOpenDevice, onOpenRegistry, onOpenTags, onMarkAllRead }) {
  const { lang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const deviceName = (a) => {
    if (a.deviceId) return devices.find((d) => d.id === a.deviceId)?.name ?? t('devices.phone');
    return a.tagId ? t('alerts.tag') : t('alerts.registered');
  };

  return (
    <div className="alerts-menu" ref={ref}>
      <button
        className={`alerts-button ${unread ? 'has-unread' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t('alerts.open', { count: unread })}
      >
        {t('alerts.title')}
        {unread > 0 && <span className="count">{unread}</span>}
      </button>
      {open && (
        <div className="alerts-popover" role="dialog" aria-label={t('alerts.title')}>
          <div className="alerts-head">
            <strong>{t('alerts.title')}</strong>
            {unread > 0 && (
              <button className="link" onClick={onMarkAllRead}>{t('alerts.markAllRead')}</button>
            )}
          </div>
          {alerts.length === 0 ? (
            <p className="hint">{t('alerts.none')}</p>
          ) : (
            <ul className="alerts-list">
              {alerts.map((a) => (
                <li key={a.id} className={a.read ? '' : 'unread'}>
                  <button
                    onClick={() => {
                      if (a.deviceId) onOpenDevice(a.deviceId);
                      else if (a.tagId) onOpenTags();
                      else onOpenRegistry();
                      setOpen(false);
                    }}
                  >
                    <strong>{deviceName(a)}</strong>
                    <span>{t(`alert.${a.type}`, { battery: a.battery ?? '?', source: a.source ?? '' })}</span>
                    {a.message && <q>{a.message}</q>}
                    {a.contactPhone && <span>{t('alerts.callFinder', { phone: a.contactPhone })}</span>}
                    <small>
                      {timeAgo(a.createdAt, lang, t)}
                      {a.smsSent ? ` · ${t('alerts.smsSent')}` : ''}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { lang, setLang, t } = useI18n();
  const [user, setUser] = useState(undefined); // undefined = still checking the session
  const [view, setView] = useState('devices');
  const [devices, setDevices] = useState(null); // null = loading
  const [selectedId, setSelectedId] = useState(null);
  const [alerts, setAlerts] = useState({ alerts: [], unread: 0 });

  // On sign-in, keep the language picked in this browser (SMS alerts use it too);
  // otherwise show the dashboard in the account's language.
  const signedIn = useCallback(
    (u) => {
      setUser(u);
      if (!u) return;
      if (hasSavedLanguage() && u.language !== lang) updateMe({ language: lang }).catch(() => {});
      else if (!hasSavedLanguage() && u.language) setLang(u.language);
    },
    [lang, setLang],
  );

  // Signing out forgets the previous person's devices, selection and alerts.
  const signedOut = useCallback(() => {
    setUser(null);
    setDevices(null);
    setSelectedId(null);
    setAlerts({ alerts: [], unread: 0 });
    setView('devices');
  }, []);

  useEffect(() => {
    setSignedOutHandler(signedOut);
    refreshSession().then(signedIn).catch(() => setUser(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const loadAlerts = useCallback(() => listAlerts().then(setAlerts).catch(() => {}), []);
  usePolling(() => user && loadAlerts(), 30000, [user]);

  if (user === undefined) return <p className="center">{t('loading')}</p>;
  if (!user) return <Login onSignedIn={signedIn} />;

  const isAdmin = user.role === 'admin';
  const isPartner = ['shop', 'police'].includes(user.role) && user.partnerId;
  const tabs = [
    ['devices', t('nav.devices')],
    ['registry', t('nav.registry')],
    ['tags', t('nav.tags')],
    ['org', t('nav.org')],
    ['billing', t('nav.billing')],
    ...(isPartner ? [['partner', t('nav.partner')]] : []),
    ...(isAdmin ? [['pilot', t('nav.pilot')], ['registryAdmin', t('nav.registryAdmin')], ['tagsAdmin', t('nav.tagsAdmin')], ['billingAdmin', t('nav.billingAdmin')]] : []),
  ];
  const current = tabs.some(([key]) => key === view) ? view : 'devices';

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">NexGuard</strong>
        <HealthDot />
        <nav className="tabs">
          {tabs.map(([key, label]) => (
            <button key={key} className={current === key ? 'active' : ''} aria-current={current === key ? 'page' : undefined} onClick={() => setView(key)}>
              {label}
            </button>
          ))}
          <a className="tab-link" href="/check" target="_blank" rel="noreferrer">{t('nav.checkPhone')}</a>
        </nav>
        <span className="spacer" />
        <AlertsMenu
          alerts={alerts.alerts}
          unread={alerts.unread}
          devices={devices ?? []}
          onOpenDevice={(id) => {
            setView('devices');
            setSelectedId(id);
          }}
          onOpenRegistry={() => setView('registry')}
          onOpenTags={() => setView('tags')}
          onMarkAllRead={() => markAlertsRead().then(loadAlerts)}
        />
        <LanguagePicker onChange={(language) => updateMe({ language }).catch(() => {})} />
        <span className="who">{user.name ?? user.phone}</span>
        <button
          className="link"
          onClick={async () => {
            await signOut();
            signedOut();
          }}
        >
          {t('signOut')}
        </button>
      </header>
      {current === 'pilot' ? (
        <PilotStats />
      ) : current === 'registryAdmin' ? (
        <AdminRegistry />
      ) : current === 'partner' ? (
        <PartnerPortal />
      ) : current === 'billingAdmin' ? (
        <BillingAdmin />
      ) : current === 'billing' ? (
        <Billing user={user} />
      ) : current === 'tagsAdmin' ? (
        <TagsAdmin />
      ) : current === 'tags' ? (
        <Tags />
      ) : current === 'org' ? (
        <OrgPage
          user={user}
          devices={devices}
          setDevices={setDevices}
          onOpenDevice={(id) => {
            setView('devices');
            setSelectedId(id);
          }}
        />
      ) : current === 'registry' ? (
        <Registry devices={devices} />
      ) : (
        <Devices
          devices={devices}
          setDevices={setDevices}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          alerts={alerts.alerts}
        />
      )}
    </div>
  );
}
