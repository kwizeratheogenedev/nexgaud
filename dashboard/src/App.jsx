import { useEffect, useState } from 'react';
import { getHealth, refreshSession, setSignedOutHandler, signOut } from './api.js';
import Login from './pages/Login.jsx';
import Devices from './pages/Devices.jsx';

function HealthDot() {
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
  const label = { loading: 'Checking service', ok: 'Service is up', degraded: 'Service has problems', down: 'Service unreachable' }[state];
  return <span className={`dot dot-${state}`} title={label} aria-label={label} role="img" />;
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking the session

  useEffect(() => {
    setSignedOutHandler(() => setUser(null));
    refreshSession().then(setUser).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <p className="center">Loading…</p>;
  if (!user) return <Login onSignedIn={setUser} />;

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">NexGuard</strong>
        <HealthDot />
        <span className="spacer" />
        <span className="who">{user.name ?? user.phone}</span>
        <button
          className="link"
          onClick={async () => {
            await signOut();
            setUser(null);
          }}
        >
          Sign out
        </button>
      </header>
      <Devices />
    </div>
  );
}
