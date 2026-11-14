import { useCallback, useEffect, useState } from 'react';
import { finderMessage, getFinderThread, scanTag, startThread } from '../api.js';
import { dateTime, formatCode } from '../format.js';
import { useI18n } from '../i18n.jsx';
import { usePolling } from '../usePolling.js';
import LanguagePicker from '../components/LanguagePicker.jsx';

// The finder's secret link to their conversation stays in this browser only.
const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // storage blocked: the conversation lasts for this visit
    }
  },
};

const errorText = (err) => (err.details ? Object.values(err.details).flat()[0] : err.message);

/** Asks the browser for the finder's position, if they ticked the box. Never waits more than 10 s. */
function currentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

function Conversation({ thread, token, onUpdate }) {
  const { lang, t } = useI18n();
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  async function send(e) {
    e.preventDefault();
    setError('');
    try {
      onUpdate(await finderMessage(token, { text: text.trim() }));
      setText('');
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section className="finder-thread">
      <h3>{t('finder.conversation')}</h3>
      <ul className="chat">
        {thread.messages.map((m, i) => (
          <li key={i} className={m.from === 'finder' ? 'mine' : 'theirs'}>
            <small>{m.from === 'finder' ? t('finder.you') : t('finder.owner')} · {dateTime(m.at, lang)}</small>
            <p>{m.text}</p>
          </li>
        ))}
      </ul>
      {thread.messages.every((m) => m.from === 'finder') && <p className="hint">{t('finder.waiting')}</p>}
      {thread.status === 'closed' ? (
        <p className="ok-text">{t('finder.closed')}</p>
      ) : (
        <form className="message-form" onSubmit={send}>
          <input aria-label={t('finder.again')} placeholder={t('finder.again')} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" disabled={!text.trim()}>{t('finder.send')}</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

export default function FinderPage({ code }) {
  const { lang, t } = useI18n();
  const seenKey = `nexguard.tag.${code.toUpperCase()}`;
  const threadKey = `nexguard.thread.${code.toUpperCase()}`;
  const [tag, setTag] = useState(null);
  const [missing, setMissing] = useState(false);
  const [token, setToken] = useState(() => storage.get(threadKey));
  const [thread, setThread] = useState(null);
  const [form, setForm] = useState({ message: '', phone: '', share: false, location: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${t('finder.title')} · NexGuard`;
  }, [lang, t]);

  useEffect(() => {
    // Reloading the page in the same browser is not a new scan.
    // Remembered before asking, so a page opened twice at once still counts one scan.
    const repeat = Boolean(storage.get(seenKey));
    storage.set(seenKey, '1');
    scanTag(code, repeat)
      .then(setTag)
      .catch(() => setMissing(true));
  }, [code, seenKey]);

  const loadThread = useCallback(async () => {
    if (!token) return;
    try {
      setThread(await getFinderThread(token));
    } catch {
      setThread(null);
    }
  }, [token]);
  usePolling(loadThread, 30000, [token]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNote('');
    try {
      const location = form.location ? await currentPosition() : null;
      if (form.location && !location) setNote(t('finder.noLocation'));
      const res = await startThread(code, {
        message: form.message.trim(),
        ...(form.phone.trim() ? { contactPhone: form.phone.trim(), shareContact: form.share } : {}),
        ...(location ? { location } : {}),
        language: lang,
      });
      storage.set(threadKey, res.token);
      setToken(res.token);
      setThread(res.thread);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  let body;
  if (missing) body = <p className="error">{t('finder.notFound')}</p>;
  else if (!tag) body = <p className="hint">{t('loading')}</p>;
  else if (tag.status === 'unclaimed') {
    body = (
      <>
        <h2>{t('finder.unclaimed')}</h2>
        <p>{t('finder.unclaimedHint')}</p>
        <a className="check-link" href="/">{t('check.signIn')} →</a>
      </>
    );
  } else if (tag.status === 'disabled') body = <h2>{t('finder.disabled')}</h2>;
  else {
    body = (
      <>
        <h2>{t('finder.title')}</h2>
        <div className={`finder-item ${tag.status === 'lost' ? 'tone-bad' : ''}`}>
          <p className="finder-name">{tag.name ?? t(`tags.kind.${tag.kind}`)} <span className="hint">· {t(`tags.kind.${tag.kind}`)}</span></p>
          <p>{tag.orgName ? t('finder.belongsOrg', { org: tag.orgName }) : t('finder.belongs')}</p>
          {tag.status === 'lost' && <p className="bad-text">{t('finder.lost')}</p>}
          {tag.message && (
            <>
              <h3>{t('finder.ownerMessage')}</h3>
              <blockquote>{tag.message}</blockquote>
            </>
          )}
        </div>

        {thread ? (
          <Conversation thread={thread} token={token} onUpdate={setThread} />
        ) : (
          <form onSubmit={submit}>
            <h3>{t('finder.write')}</h3>
            <p className="hint">{t('finder.writeIntro')}</p>
            <label htmlFor="f-message">{t('finder.message')}</label>
            <textarea id="f-message" rows={3} required minLength={2} maxLength={500} value={form.message} onChange={set('message')} />
            <label htmlFor="f-phone">{t('finder.phone')}</label>
            <input id="f-phone" type="tel" inputMode="tel" maxLength={20} placeholder="0788 123 456" value={form.phone} onChange={set('phone')} />
            <p className="hint">{t('finder.phoneHint')}</p>
            {form.phone.trim() && (
              <label className="inline check-row-label">
                <input type="checkbox" checked={form.share} onChange={set('share')} /> {t('finder.share')}
              </label>
            )}
            <label className="inline check-row-label">
              <input type="checkbox" checked={form.location} onChange={set('location')} /> {t('finder.location')}
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" className="primary" disabled={busy || form.message.trim().length < 2}>
              {busy ? t('finder.sending') : t('finder.send')}
            </button>
          </form>
        )}
        {note && <p className="hint">{note}</p>}
      </>
    );
  }

  return (
    <main className="check-page">
      <div className="card check-card">
        <div className="login-head">
          <h1>NexGuard</h1>
          <LanguagePicker />
        </div>
        {body}
        <p className="hint spaced-top">{t('finder.about')} <span className="mono">{formatCode(code.toUpperCase())}</span></p>
        <p className="legal-links">
          <a href="/check">{t('nav.checkPhone')}</a> · <a href="/privacy.html">{t('privacy')}</a> · <a href="/terms.html">{t('terms')}</a>
        </p>
      </div>
    </main>
  );
}
