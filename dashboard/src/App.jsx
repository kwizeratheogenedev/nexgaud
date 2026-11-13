import { useCallback, useEffect, useRef, useState } from 'react';
import { getHealth, listAlerts, markAlertsRead, refreshSession, setSignedOutHandler, signOut, updateMe } from './api.js';
import { hasSavedLanguage, useI18n } from './i18n.jsx';
import LanguagePicker from './components/LanguagePicker.jsx';
import { timeAgo } from './format.js';
import { usePolling } from './usePolling.js';
import Login from './pages/Login.jsx';
import Devices from './pages/Devices.jsx';
import PilotStats from './pages/PilotStats.jsx';

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

function AlertsMenu({ alerts, unread, devices, onOpenDevice, onMarkAllRead }) {
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

  const deviceName = (id) => devices.find((d) => d.id === id)?.name ?? t('devices.phone');

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
                      onOpenDevice(a.deviceId);
                      setOpen(false);
                    }}
                  >
                    <strong>{deviceName(a.deviceId)}</strong>
                    <span>{t(`alert.${a.type}`, { battery: a.battery ?? '?' })}</span>
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

  useEffect(() => {
    setSignedOutHandler(() => setUser(null));
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

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">NexGuard</strong>
        <HealthDot />
        {isAdmin && (
          <nav className="tabs">
            <button className={view === 'devices' ? 'active' : ''} onClick={() => setView('devices')}>{t('nav.devices')}</button>
            <button className={view === 'pilot' ? 'active' : ''} onClick={() => setView('pilot')}>{t('nav.pilot')}</button>
          </nav>
        )}
        <span className="spacer" />
        <AlertsMenu
          alerts={alerts.alerts}
          unread={alerts.unread}
          devices={devices ?? []}
          onOpenDevice={(id) => {
            setView('devices');
            setSelectedId(id);
          }}
          onMarkAllRead={() => markAlertsRead().then(loadAlerts)}
        />
        <LanguagePicker onChange={(language) => updateMe({ language }).catch(() => {})} />
        <span className="who">{user.name ?? user.phone}</span>
        <button
          className="link"
          onClick={async () => {
            await signOut();
            setUser(null);
          }}
        >
          {t('signOut')}
        </button>
      </header>
      {view === 'pilot' && isAdmin ? (
        <PilotStats />
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
