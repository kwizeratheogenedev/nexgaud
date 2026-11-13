import { useState } from 'react';
import { getPilotStats } from '../api.js';
import { timeAgo } from '../format.js';
import { usePolling } from '../usePolling.js';

// For the NexGuard team during the pilot (English only). Counts and phone models, no personal data.
const ISSUE_LABELS = {
  locationNotAlways: 'Location not "all the time"',
  batteryOptimized: 'Battery optimisation on',
  notificationsOff: 'Notifications off',
  remoteLockOff: 'Remote lock off',
};

function Stat({ label, value, note, tone }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function Breakdown({ title, rows, keyName, keyLabel }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <table className="table">
        <thead>
          <tr><th>{keyLabel}</th><th className="num">Devices</th><th className="num">Seen 24 h</th><th className="bar-cell">Share seen</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[keyName]}>
              <td>{r[keyName]}</td>
              <td className="num">{r.devices}</td>
              <td className="num">{r.seen24h}</td>
              <td className="bar-cell">
                <span className="bar" aria-hidden="true"><span style={{ width: `${r.seenPct}%` }} className={r.seenPct >= 90 ? 'ok' : 'low'} /></span>
                <span className="num">{r.seenPct}%</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function PilotStats() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  usePolling(
    () => getPilotStats().then(setStats).catch((err) => setError(err.message)),
    60000,
    [],
  );

  if (error && !stats) return <p className="center error">{error}</p>;
  if (!stats) return <p className="center">Loading…</p>;

  const gate = stats.pilotGate;
  return (
    <main className="pilot">
      <section className={`card gate ${gate.passed ? 'passed' : ''}`}>
        <h2>Phase 2 gate: {gate.passed ? 'passed' : 'not yet'}</h2>
        <p className="hint">{gate.usersTarget} pilot users, with {gate.seenTarget}% of devices seen in the last 24 hours.</p>
        <div className="stats">
          <Stat label="Pilot users" value={`${gate.users} / ${gate.usersTarget}`} tone={gate.users >= gate.usersTarget ? 'good' : ''} />
          <Stat
            label="Devices seen in 24 h"
            value={`${stats.seenPct}%`}
            note={`${stats.seen24h} of ${stats.devices}`}
            tone={stats.seenPct >= gate.seenTarget ? 'good' : 'bad'}
          />
          <Stat label="Marked lost" value={stats.statuses.lost ?? 0} />
        </div>
      </section>

      <div className="pilot-grid">
        <Breakdown title="By phone brand" rows={stats.byBrand} keyName="brand" keyLabel="Brand" />
        <Breakdown title="By Android version" rows={stats.byOsVersion} keyName="osVersion" keyLabel="Android" />

        <section className="card">
          <h2>Setup problems</h2>
          <table className="table">
            <tbody>
              {Object.entries(stats.permissionIssues).map(([k, v]) => (
                <tr key={k}><td>{ISSUE_LABELS[k] ?? k}</td><td className="num">{v}</td></tr>
              ))}
            </tbody>
          </table>
          <h2 className="spaced">Alerts, last 7 days</h2>
          {Object.keys(stats.alerts7d).length === 0 ? (
            <p className="hint">None.</p>
          ) : (
            <table className="table">
              <tbody>
                {Object.entries(stats.alerts7d).map(([k, v]) => (
                  <tr key={k}><td>{k.replace('_', ' ')}</td><td className="num">{v}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <h2>Quiet for over 24 hours</h2>
          <p className="hint">Which phones lose tracking. Ask these owners to re-run setup.</p>
          {stats.quietDevices.length === 0 ? (
            <p className="hint">None.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Phone</th><th>Android</th><th>Last seen</th><th>Setup</th></tr>
              </thead>
              <tbody>
                {stats.quietDevices.map((d) => (
                  <tr key={d.id}>
                    <td>{[d.brand, d.model].filter(Boolean).join(' ') || '—'}</td>
                    <td>{d.osVersion ?? '—'}</td>
                    <td>{timeAgo(d.lastSeenAt, 'en', (k) => ({ never: 'never', justNow: 'just now' })[k])}</td>
                    <td>
                      {[!d.locationAlways && 'location', d.batteryOptimized && 'battery'].filter(Boolean).join(', ') || 'OK'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <p className="hint">Updated {new Date(stats.generatedAt).toLocaleTimeString()}. Refreshes every minute.</p>
    </main>
  );
}
