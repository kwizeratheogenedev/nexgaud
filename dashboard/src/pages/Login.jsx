import { useState } from 'react';
import { requestCode, verifyCode } from '../api.js';
import { useI18n } from '../i18n.jsx';
import LanguagePicker from '../components/LanguagePicker.jsx';

export default function Login({ onSignedIn }) {
  const { t } = useI18n();
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
        <div className="login-head">
          <h1>NexGuard</h1>
          <LanguagePicker />
        </div>
        <p className="lead">{t('login.lead')}</p>

        {step === 'phone' ? (
          <form onSubmit={submitPhone}>
            <label htmlFor="phone">{t('login.phone')}</label>
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
            <p className="hint">{t('login.phoneHint')}</p>
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" className="primary" disabled={busy || !phone.trim()}>
              {busy ? t('login.sending') : t('login.sendCode')}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode}>
            <p>
              {t('login.codeSentTo', { phone: sentTo })}{' '}
              <button type="button" className="link" onClick={() => { setStep('phone'); setCode(''); setError(''); }}>
                {t('login.changeNumber')}
              </button>
            </p>
            <label htmlFor="code">{t('login.code')}</label>
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
            <label htmlFor="name">{t('login.name')}</label>
            <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" className="primary" disabled={busy || code.length !== 6}>
              {busy ? t('login.checking') : t('login.signIn')}
            </button>
          </form>
        )}
        <p className="legal-links">
          <a href="/privacy.html">{t('privacy')}</a> · <a href="/terms.html">{t('terms')}</a>
        </p>
      </div>
    </main>
  );
}
