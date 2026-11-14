import { useEffect, useState } from 'react';
import { checkPhone, sendTip } from '../api.js';
import { useI18n } from '../i18n.jsx';
import LanguagePicker from '../components/LanguagePicker.jsx';

const TONE = { stolen: 'bad', lost: 'bad', registered: 'ok', not_registered: 'neutral', invalid: 'warn' };

function deviceName(device) {
  return device ? [device.brand, device.model].filter(Boolean).join(' ') : '';
}

/** A message from someone who has seen a reported phone, sent to its owner. */
function TipForm({ query }) {
  const { t } = useI18n();
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | sent
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setState('sending');
    setError('');
    try {
      await sendTip({ q: query, message: message.trim(), ...(phone.trim() ? { contactPhone: phone.trim() } : {}) });
      setState('sent');
    } catch (err) {
      setError(err.details ? Object.values(err.details).flat()[0] : err.message);
      setState('idle');
    }
  }

  if (state === 'sent') return <p className="ok-text" role="status">{t('check.tipSent')}</p>;
  return (
    <form className="tip-form" onSubmit={submit}>
      <h3>{t('check.tipTitle')}</h3>
      <p className="hint">{t('check.tipIntro')}</p>
      <label htmlFor="tip-message">{t('check.tipMessage')}</label>
      <textarea id="tip-message" rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} required minLength={5} />
      <label htmlFor="tip-phone">{t('check.tipPhone')}</label>
      <input id="tip-phone" type="tel" inputMode="tel" maxLength={20} placeholder="0788 123 456" value={phone} onChange={(e) => setPhone(e.target.value)} />
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={state === 'sending' || message.trim().length < 5}>
        {t('check.tipSend')}
      </button>
    </form>
  );
}

export default function CheckPage() {
  const { lang, t } = useI18n();
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '');
  const [checked, setChecked] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${t('check.title')} · NexGuard`;
  }, [lang, t]);

  // A link such as /check?q=356938035643809 checks at once.
  useEffect(() => {
    if (q.trim()) submit();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e?.preventDefault();
    const query = q.trim();
    if (!query) return;
    setBusy(true);
    setError('');
    try {
      setResult(await checkPhone(query));
      setChecked(query);
    } catch (err) {
      setResult(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const tone = result ? TONE[result.result] : null;
  const reported = result && ['stolen', 'lost'].includes(result.result);

  return (
    <main className="check-page">
      <div className="card check-card">
        <div className="login-head">
          <h1>NexGuard</h1>
          <LanguagePicker />
        </div>
        <h2>{t('check.title')}</h2>
        <p className="lead">{t('check.lead')}</p>

        <form className="check-form" onSubmit={submit}>
          <label htmlFor="check-q">{t('check.input')}</label>
          <div className="check-row">
            <input
              id="check-q"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              placeholder="35 693803 564380 9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
            <button type="submit" className="primary-inline" disabled={busy || !q.trim()}>
              {busy ? t('check.checking') : t('check.button')}
            </button>
          </div>
          <p className="hint">{t('check.dial')}</p>
        </form>

        {error && <p className="error" role="alert">{error}</p>}

        {result && (
          <section className={`check-result tone-${tone}`} aria-live="polite">
            <p className="check-verdict">{t(`check.result.${result.result}`)}</p>
            {result.display && <p className="mono">{result.display}</p>}
            {result.result === 'invalid' ? (
              <p>{t(`check.reason.${result.reason}`)}</p>
            ) : (
              <>
                {result.device && (
                  <dl>
                    <dt>{t('check.device')}</dt>
                    <dd>{deviceName(result.device)}{result.device.color ? ` · ${result.device.color}` : ''}</dd>
                  </dl>
                )}
                {result.reportedOn && <p className="hint">{t('check.reportedOn', { date: new Date(result.reportedOn).toLocaleDateString(lang) })}</p>}
                <p>{t(`check.adv.${result.result}`)}</p>
                {result.device && <p className="hint">{t('check.matchHint', { device: deviceName(result.device) })}</p>}
              </>
            )}
          </section>
        )}

        {reported && <TipForm key={checked} query={checked} />}

        <p className="hint">{t('check.sms')}</p>
        <p className="legal-links">
          <a href="/">{t('check.signIn')}</a> · <a href="/privacy.html">{t('privacy')}</a> · <a href="/terms.html">{t('terms')}</a>
        </p>
      </div>
    </main>
  );
}
