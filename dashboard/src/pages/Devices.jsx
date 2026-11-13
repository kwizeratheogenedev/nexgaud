import { useCallback, useEffect, useState } from 'react';
import { getRoute, listCommands, listDevices, removeDevice, sendCommand, updateDevice } from '../api.js';
import { COMMAND_LABELS, STATUS_LABELS, dateTime, isOnline, timeAgo } from '../format.js';
import DeviceMap from '../components/DeviceMap.jsx';

const ROUTE_HOURS = 24;

function usePolling(fn, ms, deps) {
  useEffect(() => {
    let alive = true;
    const run = () => alive && fn();
    run();
    const id = setInterval(run, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

function DeviceListItem({ device, selected, onSelect }) {
  const online = isOnline(device);
  return (
    <li>
      <button className={`device-item ${selected ? 'selected' : ''}`} onClick={onSelect} aria-pressed={selected}>
        <span className={`dot ${online ? 'dot-ok' : 'dot-off'}`} aria-hidden="true" />
        <span className="device-item-text">
          <strong>{device.name}</strong>
          <small>
            {online ? 'Online' : `Last seen ${timeAgo(device.lastSeenAt)}`}
            {device.battery != null && ` · ${device.battery}%`}
          </small>
        </span>
        {device.status === 'lost' && <span className="badge badge-lost">Lost</span>}
      </button>
    </li>
  );
}

function PermissionWarnings({ device }) {
  const p = device.permissions ?? {};
  const warnings = [];
  if (p.location && p.location !== 'always') warnings.push('Location is not set to "Allow all the time", so tracking stops when the app is closed.');
  if (p.batteryOptimized) warnings.push('Battery optimisation is on for NexGuard. The phone may stop sending locations.');
  if (p.deviceAdmin === false) warnings.push('Lock is not enabled on the phone (device admin is off).');
  if (!warnings.length) return null;
  return (
    <ul className="warnings">
      {warnings.map((w) => <li key={w}>{w}</li>)}
    </ul>
  );
}

function CommandPanel({ device, commands, onSend, busy }) {
  const [message, setMessage] = useState('');
  return (
    <div className="panel-section">
      <h3>Actions</h3>
      <div className="actions">
        <button onClick={() => onSend('ring')} disabled={busy}>Ring</button>
        <button onClick={() => onSend('locate')} disabled={busy}>Locate now</button>
        <button onClick={() => onSend('lock')} disabled={busy || device.permissions?.deviceAdmin === false}>Lock</button>
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
          placeholder="Message to show on the lock screen"
          maxLength={200}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-label="Message to show on the phone"
        />
        <button type="submit" disabled={busy || !message.trim()}>Show</button>
      </form>
      {!device.pushEnabled && (
        <p className="hint">Instant delivery is not set up yet, so the phone gets actions when it next sends its location (within a few minutes).</p>
      )}

      <h3>Recent actions</h3>
      {commands.length === 0 ? (
        <p className="hint">No actions yet.</p>
      ) : (
        <ul className="commands">
          {commands.map((c) => (
            <li key={c.id}>
              <span>{COMMAND_LABELS[c.type]}</span>
              <span className={`badge badge-${c.status}`}>{STATUS_LABELS[c.status]}</span>
              <small>{timeAgo(c.createdAt)}{c.result ? ` · ${c.result}` : ''}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Devices() {
  const [devices, setDevices] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
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
  }, []);

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

  async function toggleLost() {
    const status = selected.status === 'lost' ? 'recovered' : 'lost';
    const updated = await updateDevice(selected.id, { status }).catch((err) => setError(err.message));
    if (updated) setDevices((ds) => ds.map((d) => (d.id === updated.id ? updated : d)));
  }

  async function remove() {
    if (!window.confirm(`Remove "${selected.name}"? Its location history is deleted and the phone stops being protected until it is added again.`)) return;
    await removeDevice(selected.id).catch((err) => setError(err.message));
    await loadDevices();
  }

  if (devices === null) return <p className="center">Loading your devices…</p>;

  if (devices.length === 0) {
    return (
      <section className="card empty">
        <h2>No devices yet</h2>
        <ol>
          <li>Install the NexGuard app on the phone you want to protect.</li>
          <li>Sign in with this same phone number.</li>
          <li>Follow the setup steps and allow location "all the time".</li>
        </ol>
        <p className="hint">The phone appears here as soon as it is set up.</p>
      </section>
    );
  }

  return (
    <div className="workspace">
      <aside className="sidebar">
        <h2>Your devices</h2>
        <ul className="device-list">
          {devices.map((d) => (
            <DeviceListItem key={d.id} device={d} selected={d.id === selectedId} onSelect={() => setSelectedId(d.id)} />
          ))}
        </ul>
      </aside>

      <section className="map-area">
        <DeviceMap device={selected} route={route} />
        {!selected?.lastLocation && <p className="map-note">No location yet. It appears once the phone sends its first one.</p>}
      </section>

      {selected && (
        <aside className="panel">
          <div className="panel-section">
            <h2>{selected.name}</h2>
            <p className="hint">{[selected.brand, selected.model].filter(Boolean).join(' ') || 'Phone'}</p>
            <dl>
              <dt>Last location</dt>
              <dd>{selected.lastLocation ? `${timeAgo(selected.lastLocation.at)} (±${Math.round(selected.lastLocation.accuracyM ?? 0)} m)` : '—'}</dd>
              <dt>Last seen</dt>
              <dd title={dateTime(selected.lastSeenAt)}>{timeAgo(selected.lastSeenAt)}</dd>
              <dt>Battery</dt>
              <dd>{selected.battery != null ? `${selected.battery}%${selected.charging ? ' (charging)' : ''}` : '—'}</dd>
              <dt>Route shown</dt>
              <dd>{route.length} points, last {ROUTE_HOURS} hours</dd>
            </dl>
            <PermissionWarnings device={selected} />
            {error && <p className="error" role="alert">{error}</p>}
          </div>

          <CommandPanel device={selected} commands={commands} onSend={send} busy={busy} />

          <div className="panel-section">
            <button className={selected.status === 'lost' ? '' : 'danger'} onClick={toggleLost}>
              {selected.status === 'lost' ? 'I found it' : 'Mark as lost'}
            </button>
            <button className="link danger-link" onClick={remove}>Remove this device</button>
          </div>
        </aside>
      )}
    </div>
  );
}
