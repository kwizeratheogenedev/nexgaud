import { useCallback, useState } from 'react';
import { getRoute, listCommands, listDevices, removeDevice, sendCommand, updateDevice } from '../api.js';
import { dateTime, isLost, isOnline, timeAgo } from '../format.js';
import { useI18n } from '../i18n.jsx';
import { usePolling } from '../usePolling.js';
import DeviceMap from '../components/DeviceMap.jsx';

const ROUTE_HOURS = 24;

function DeviceListItem({ device, selected, onSelect }) {
  const { lang, t } = useI18n();
  const online = isOnline(device);
  return (
    <li>
      <button className={`device-item ${selected ? 'selected' : ''}`} onClick={onSelect} aria-pressed={selected}>
        <span className={`dot ${online ? 'dot-ok' : 'dot-off'}`} aria-hidden="true" />
        <span className="device-item-text">
          <strong>{device.name}</strong>
          <small>
            {online ? t('devices.online') : t('devices.lastSeenAgo', { time: timeAgo(device.lastSeenAt, lang, t) })}
            {device.battery != null && ` · ${device.battery}%`}
          </small>
        </span>
        {isLost(device) && <span className="badge badge-lost">{t('devices.lostBadge')}</span>}
      </button>
    </li>
  );
}

function PermissionWarnings({ device }) {
  const { t } = useI18n();
  const p = device.permissions ?? {};
  const warnings = [];
  if (p.location && p.location !== 'always') warnings.push(t('warn.location'));
  if (p.batteryOptimized) warnings.push(t('warn.battery'));
  if (p.deviceAdmin === false) warnings.push(t('warn.admin'));
  if (!warnings.length) return null;
  return (
    <ul className="warnings">
      {warnings.map((w) => <li key={w}>{w}</li>)}
    </ul>
  );
}

function CommandPanel({ device, commands, onSend, busy }) {
  const { lang, t } = useI18n();
  const [message, setMessage] = useState('');
  return (
    <div className="panel-section">
      <h3>{t('actions.title')}</h3>
      <div className="actions">
        <button onClick={() => onSend('ring')} disabled={busy}>{t('actions.ring')}</button>
        <button onClick={() => onSend('locate')} disabled={busy}>{t('actions.locate')}</button>
        <button onClick={() => onSend('lock')} disabled={busy || device.permissions?.deviceAdmin === false}>
          {t('actions.lock')}
        </button>
      </div>
      <form
        className="message-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSend('message', { message: message.trim() });
          setMessage('');
        }}
      >
        <input
          placeholder={t('actions.messagePlaceholder')}
          maxLength={200}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-label={t('actions.messagePlaceholder')}
        />
        <button type="submit" disabled={busy || !message.trim()}>{t('actions.show')}</button>
      </form>
      {!device.pushEnabled && <p className="hint">{t('actions.noPush')}</p>}

      <h3>{t('actions.recent')}</h3>
      {commands.length === 0 ? (
        <p className="hint">{t('actions.none')}</p>
      ) : (
        <ul className="commands">
          {commands.map((c) => (
            <li key={c.id}>
              <span>{t(`command.${c.type}`)}</span>
              <span className={`badge badge-${c.status}`}>{t(`status.${c.status}`)}</span>
              <small>{timeAgo(c.createdAt, lang, t)}{c.result ? ` · ${c.result}` : ''}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Mark as lost (with the message shown on the phone), edit that message, or mark as found. */
function LostPanel({ device, onSave, busy }) {
  const { lang, t } = useI18n();
  const lost = isLost(device);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');

  const startEditing = () => {
    setMessage(device.lostMode?.message ?? t('lost.defaultMessage'));
    setContact(device.lostMode?.contactPhone ?? '');
    setEditing(true);
  };

  async function submit(e) {
    e.preventDefault();
    const ok = await onSave({
      ...(lost ? {} : { status: 'lost' }),
      lostMessage: message.trim(),
      contactPhone: contact.trim(),
    });
    if (ok) setEditing(false);
  }

  if (editing) {
    return (
      <form className="panel-section lost-form" onSubmit={submit}>
        <h3>{lost ? t('lost.title') : t('lost.markLost')}</h3>
        <p className="hint">{t('lost.formIntro')}</p>
        <label htmlFor="lost-message">{t('lost.message')}</label>
        <textarea id="lost-message" maxLength={200} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        <label htmlFor="lost-contact">{t('lost.contact')}</label>
        <input
          id="lost-contact"
          type="tel"
          inputMode="tel"
          placeholder="0788 123 456"
          maxLength={20}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
        <div className="actions">
          <button type="submit" className={lost ? '' : 'danger'} disabled={busy}>
            {lost ? t('lost.save') : t('lost.markLost')}
          </button>
          <button type="button" className="link" onClick={() => setEditing(false)}>{t('lost.cancel')}</button>
        </div>
      </form>
    );
  }

  if (!lost) {
    return (
      <div className="panel-section">
        <button className="danger" onClick={startEditing}>{t('lost.markLost')}</button>
      </div>
    );
  }

  return (
    <div className="panel-section lost-box">
      <h3>{t('lost.title')}</h3>
      <p className="hint">{t('lost.intro')}</p>
      {device.lostMode?.message && <blockquote>{device.lostMode.message}</blockquote>}
      {device.lostMode?.contactPhone && <p>📞 {device.lostMode.contactPhone}</p>}
      {device.lostMode?.since && <p className="hint" title={dateTime(device.lostMode.since, lang)}>{timeAgo(device.lostMode.since, lang, t)}</p>}
      <div className="actions">
        <button onClick={startEditing}>{t('lost.edit')}</button>
        <button className="primary-inline" onClick={() => onSave({ status: 'recovered' })} disabled={busy}>
          {t('lost.found')}
        </button>
      </div>
    </div>
  );
}

function DeviceAlerts({ alerts }) {
  const { lang, t } = useI18n();
  if (!alerts.length) return null;
  return (
    <div className="panel-section">
      <h3>{t('alerts.title')}</h3>
      <ul className="commands">
        {alerts.slice(0, 5).map((a) => (
          <li key={a.id}>
            <span>{t(`alert.${a.type}`, { battery: a.battery ?? '?' })}</span>
            <small>
              {timeAgo(a.createdAt, lang, t)}
              {a.smsSent ? ` · ${t('alerts.smsSent')}` : ''}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Devices({ devices, setDevices, selectedId, setSelectedId, alerts }) {
  const { lang, t } = useI18n();
  const [route, setRoute] = useState([]);
  const [commands, setCommands] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selected = devices?.find((d) => d.id === selectedId) ?? null;

  const loadDevices = useCallback(async () => {
    try {
      const list = await listDevices();
      setDevices(list);
      setSelectedId((cur) => (cur && list.some((d) => d.id === cur) ? cur : list[0]?.id ?? null));
    } catch (err) {
      setError(err.message);
    }
  }, [setDevices, setSelectedId]);

  usePolling(loadDevices, 30000, []);

  usePolling(
    async () => {
      if (!selectedId) return setRoute([]);
      const to = new Date();
      const from = new Date(to.getTime() - ROUTE_HOURS * 3600 * 1000);
      setRoute(await getRoute(selectedId, from, to).catch(() => []));
    },
    60000,
    [selectedId],
  );

  const waiting = commands.some((c) => c.status === 'queued' || c.status === 'sent');
  usePolling(
    async () => {
      if (!selectedId) return setCommands([]);
      setCommands(await listCommands(selectedId).catch(() => []));
    },
    waiting ? 5000 : 30000,
    [selectedId, waiting],
  );

  async function send(type, payload) {
    setBusy(true);
    setError('');
    try {
      const cmd = await sendCommand(selected.id, type, payload);
      setCommands((cs) => [cmd, ...cs]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveDevice(changes) {
    setBusy(true);
    setError('');
    try {
      const updated = await updateDevice(selected.id, changes);
      setDevices((ds) => ds.map((d) => (d.id === updated.id ? updated : d)));
      return true;
    } catch (err) {
      if (err.details?.contactPhone) setError(t('lost.contactInvalid'));
      else setError(err.details ? Object.values(err.details).flat()[0] : err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t('devices.removeConfirm', { name: selected.name }))) return;
    await removeDevice(selected.id).catch((err) => setError(err.message));
    await loadDevices();
  }

  if (devices === null) return <p className="center">{t('devices.loading')}</p>;

  if (devices.length === 0) {
    return (
      <section className="card empty">
        <h2>{t('devices.emptyTitle')}</h2>
        <ol>
          <li>{t('devices.empty1')}</li>
          <li>{t('devices.empty2')}</li>
          <li>{t('devices.empty3')}</li>
        </ol>
        <p className="hint">{t('devices.emptyHint')}</p>
      </section>
    );
  }

  const deviceAlerts = selected ? alerts.filter((a) => a.deviceId === selected.id) : [];

  return (
    <div className="workspace">
      <aside className="sidebar">
        <h2>{t('devices.yours')}</h2>
        <ul className="device-list">
          {devices.map((d) => (
            <DeviceListItem key={d.id} device={d} selected={d.id === selectedId} onSelect={() => setSelectedId(d.id)} />
          ))}
        </ul>
      </aside>

      <section className="map-area">
        <DeviceMap device={selected} route={route} />
        {!selected?.lastLocation && <p className="map-note">{t('devices.noLocation')}</p>}
      </section>

      {selected && (
        <aside className="panel">
          <div className="panel-section">
            <h2>{selected.name}</h2>
            <p className="hint">{[selected.brand, selected.model].filter(Boolean).join(' ') || t('devices.phone')}</p>
            <dl>
              <dt>{t('devices.lastLocation')}</dt>
              <dd>
                {selected.lastLocation
                  ? `${timeAgo(selected.lastLocation.at, lang, t)} (±${Math.round(selected.lastLocation.accuracyM ?? 0)} m)`
                  : '—'}
              </dd>
              <dt>{t('devices.lastSeen')}</dt>
              <dd title={dateTime(selected.lastSeenAt, lang)}>{timeAgo(selected.lastSeenAt, lang, t)}</dd>
              <dt>{t('devices.battery')}</dt>
              <dd>
                {selected.battery != null ? `${selected.battery}%${selected.charging ? ` ${t('devices.charging')}` : ''}` : '—'}
              </dd>
              <dt>{t('devices.route')}</dt>
              <dd>{t('devices.routeValue', { count: route.length, hours: ROUTE_HOURS })}</dd>
              {selected.simChangedAt && (
                <>
                  <dt>{t('devices.simChanged')}</dt>
                  <dd className="bad" title={dateTime(selected.simChangedAt, lang)}>{timeAgo(selected.simChangedAt, lang, t)}</dd>
                </>
              )}
            </dl>
            <PermissionWarnings device={selected} />
            {error && <p className="error" role="alert">{error}</p>}
          </div>

          <LostPanel key={selected.id} device={selected} onSave={saveDevice} busy={busy} />
          <DeviceAlerts alerts={deviceAlerts} />
          <CommandPanel device={selected} commands={commands} onSend={send} busy={busy} />

          <div className="panel-section">
            <button className="link danger-link" onClick={remove}>{t('devices.remove')}</button>
          </div>
        </aside>
      )}
    </div>
  );
}
