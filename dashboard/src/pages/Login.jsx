import { useState } from 'react';
import { requestCode, verifyCode } from '../api.js';

export default function Login({ onSignedIn }) {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submitPhone(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await requestCode(phone);
      setSentTo(res.phone);
      setStep('code');
    } catch (err) {
      setError(err.details?.phone?.[0] ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSignedIn(await verifyCode(sentTo, code.trim(), name.trim() || undefined));
    } catch (err) {
      setError(err.details?.code?.[0] ?? err.message);
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="card login-card">
        <h1>NexGuard</h1>
        <p className="lead">See where your phone is, ring it, or lock it.</p>

        {step === 'phone' ? (
          <form onSubmit={submitPhone}>
            <label htmlFor="phone">Phone number</label>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0788 123 456"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              autoFocus
            />
            <p className="hint">Use the same number you signed in with on the NexGuard app.</p>
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" className="primary" disabled={busy || !phone.trim()}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode}>
            <p>
              We sent a 6-digit code to <strong>{sentTo}</strong>.{' '}
              <button type="button" className="link" onClick={() => { setStep('phone'); setCode(''); setError(''); }}>
                Change number
              </button>
            </p>
            <label htmlFor="code">Code</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
            />
            <label htmlFor="name">Your name (only needed the first time)</label>
            <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" className="primary" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
