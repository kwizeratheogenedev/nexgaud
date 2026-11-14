import { useCallback, useEffect, useState } from 'react';
import { createApiKey, getPartner, partnerCheck, partnerChecks, revokeApiKey } from '../api.js';
import { dateTime, timeAgo } from '../format.js';
import { useI18n } from '../i18n.jsx';

const MAX_LINES = 100;

function ResultBadge({ result }) {
  const { t } = useI18n();
  return <span className={`badge badge-check-${result}`}>{t(`check.result.${result}`)}</span>;
}

const deviceName = (d) => (d ? [d.brand, d.model].filter(Boolean).join(' ') : '—');

function Checker({ partner, onChecked }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lines = [...new Set(text.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean))];

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setResults(await partnerCheck(lines.slice(0, MAX_LINES)));
      onChecked();
    } catch (err) {
      setError(err.details ? Object.values(err.details).flat()[0] : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>{t('partner.title')}</h2>
      <p className="hint">{t('partner.intro')}</p>
      <form onSubmit={submit}>
        <label htmlFor="partner-items">{t('partner.items')}</label>
        <textarea id="partner-items" className="mono" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={'356938035643809\n867542031122338'} />
        <p className="hint">{lines.length} / {MAX_LINES}</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={busy || lines.length === 0 || lines.length > MAX_LINES}>
          {busy ? t('check.checking') : t('partner.check')}
        </button>
      </form>

      {results && (
        <div className="spaced-top">
          <p><strong>{t('partner.summary', results.summary)}</strong></p>
          {results.summary.flagged > 0 && <p className="warnings-inline">{t('partner.stolenWarning')}</p>}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>{t('partner.input')}</th><th>{t('partner.result')}</th><th>{t('partner.device')}</th></tr>
              </thead>
              <tbody>
                {results.results.map((r, i) => (
                  <tr key={`${r.input}-${i}`} className={['stolen', 'lost'].includes(r.result) ? 'row-bad' : ''}>
                    <td className="mono">{r.input}</td>
                    <td>
                      <ResultBadge result={r.result} />
                      {r.result === 'invalid' && <small className="block">{t(`check.reason.${r.reason}`)}</small>}
                    </td>
                    <td>
                      {deviceName(r.device)}
                      {r.police && partner.type === 'police' && (
                        <small className="block">{t('partner.police', { case: r.police.caseNumber ?? '—', station: r.police.station ?? '—', place: r.police.place })}</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function History({ history }) {
  const { lang, t } = useI18n();
  if (!history) return null;
  return (
    <section className="card">
      <h2>{t('partner.recent')}</h2>
      <p className="hint">{t('partner.week', history.week)}</p>
      {history.checks.length === 0 ? (
        <p className="hint">{t('partner.none')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>{t('partner.when')}</th><th>{t('partner.result')}</th><th>{t('partner.device')}</th><th>{t('partner.via')}</th></tr>
            </thead>
            <tbody>
              {history.checks.map((c) => (
                <tr key={c.id}>
                  <td title={dateTime(c.createdAt, lang)}>{timeAgo(c.createdAt, lang, t)}</td>
                  <td><ResultBadge result={c.result} /></td>
                  <td>{c.device ?? '—'}</td>
                  <td>{t(`partner.source.${c.source}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ApiKeys({ partner, onChange }) {
  const { lang, t } = useI18n();
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState('');

  async function create(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await createApiKey(name.trim());
      setNewKey(res.key);
      setName('');
      onChange();
    } catch (err) {
      setError(err.details ? Object.values(err.details).flat()[0] : err.message);
    }
  }

  async function revoke(key) {
    if (!window.confirm(t('partner.revokeConfirm', { name: key.name }))) return;
    await revokeApiKey(key.id).catch((err) => setError(err.message));
    onChange();
  }

  return (
    <section className="card">
      <h2>{t('partner.keys')}</h2>
      <p className="hint">{t('partner.keysIntro')}</p>
      {newKey && (
        <div className="key-once">
          <p>{t('partner.keyOnce')}</p>
          <code className="mono">{newKey}</code>
        </div>
      )}
      {partner.apiKeys.length === 0 ? (
        <p className="hint">{t('partner.noKeys')}</p>
      ) : (
        <ul className="commands">
          {partner.apiKeys.map((k) => (
            <li key={k.id}>
              <span>{k.name} <code className="mono">{k.prefix}…</code></span>
              <button className="link danger-text" onClick={() => revoke(k)}>{t('partner.revoke')}</button>
              <small>{dateTime(k.createdAt, lang)}{k.lastUsedAt ? ` · ${t('partner.lastUsed', { time: timeAgo(k.lastUsedAt, lang, t) })}` : ''}</small>
            </li>
          ))}
        </ul>
      )}
      <form className="message-form" onSubmit={create}>
        <input aria-label={t('partner.keyName')} placeholder={t('partner.keyName')} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={!name.trim()}>{t('partner.createKey')}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

export default function PartnerPortal() {
  const { t } = useI18n();
  const [partner, setPartner] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    getPartner().then((d) => setPartner(d.partner)).catch((err) => setError(err.message));
    partnerChecks().then(setHistory).catch(() => {});
  }, []);
  useEffect(load, [load]);

  if (!partner) return <p className="center">{error || t('loading')}</p>;
  return (
    <main className="registry">
      <section className="registry-head">
        <div>
          <h1>{partner.name}</h1>
          <p className="hint">{[partner.district, partner.type].filter(Boolean).join(' · ')}</p>
        </div>
      </section>
      <div className="item-grid">
        <Checker partner={partner} onChecked={() => partnerChecks().then(setHistory).catch(() => {})} />
        <History history={history} />
        <ApiKeys partner={partner} onChange={load} />
      </div>
    </main>
  );
}
