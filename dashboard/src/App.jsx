import { useEffect, useState } from 'react';
import { getHealth } from './api.js';

const LABELS = {
  loading: 'Checking…',
  ok: 'API and database are up',
  degraded: 'API is up, database is not connected',
  down: 'API is not reachable',
};

export default function App() {
  const [health, setHealth] = useState({ state: 'loading' });

  useEffect(() => {
    let alive = true;
    const check = () =>
      getHealth()
        .then((h) => alive && setHealth({ state: h.status === 'ok' ? 'ok' : 'degraded', ...h }))
        .catch(() => alive && setHealth({ state: 'down' }));
    check();
    const id = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <main className="shell">
      <header>
        <h1>NexGuard</h1>
        <p className="lead">Owner dashboard — Phase 0 skeleton. The map, devices and commands arrive in Phase 1.</p>
      </header>

      <section className="card">
        <h2>System status</h2>
        <p className={`status status-${health.state}`}>
          <span className="dot" aria-hidden="true" />
          {LABELS[health.state]}
        </p>
        {health.startedAt && (
          <dl>
            <dt>Database</dt>
            <dd>{health.db}</dd>
            <dt>API version</dt>
            <dd>{health.version}</dd>
            <dt>Uptime</dt>
            <dd>{health.uptimeSec}s</dd>
          </dl>
        )}
      </section>
    </main>
  );
}
