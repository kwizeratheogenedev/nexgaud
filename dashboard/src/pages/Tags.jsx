import { useCallback, useEffect, useState } from 'react';
import { claimTag, closeThread, createTags, disableTag, listOrgs, listTags, listThreads, readThread, replyThread, updateTag } from '../api.js';
import { dateTime, formatCode, timeAgo } from '../format.js';
import { useI18n } from '../i18n.jsx';
import { usePolling } from '../usePolling.js';
import StickerSheet from '../components/StickerSheet.jsx';

const KINDS = ['keys', 'bag', 'wallet', 'laptop', 'phone', 'pet', 'other'];
const errorText = (err) => (err.details ? Object.values(err.details).flat()[0] : err.message);

function useStickerLabels() {
  const { t } = useI18n();
  return { print: t('tags.print'), close: t('laptop.done'), hint: t('tags.printHint'), scan: t('tags.stickerScan'), claim: t('tags.claimCode') };
}

function OrgSelect({ orgs, value, onChange, id }) {
  const { t } = useI18n();
  if (!orgs.length) return null;
  return (
    <div>
      <label htmlFor={id}>{t('tags.for')}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('tags.personal')}</option>
        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}

function NewTags({ orgs, onCreated }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: '', kind: 'keys', message: '', count: 1, orgId: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      const tags = await createTags({
        name: form.name.trim(),
        kind: form.kind,
        ...(form.message.trim() ? { message: form.message.trim() } : {}),
        count: Number(form.count),
        ...(form.orgId ? { orgId: form.orgId } : {}),
      });
      setForm((f) => ({ ...f, name: '', count: 1 }));
      onCreated(tags);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{t('tags.new')}</h2>
      <div className="form-grid">
        <div>
          <label htmlFor="tag-name">{t('tags.name')}</label>
          <input id="tag-name" required maxLength={36} placeholder={t('tags.kind.keys')} value={form.name} onChange={set('name')} />
        </div>
        <div>
          <label htmlFor="tag-kind">{t('tags.kind')}</label>
          <select id="tag-kind" value={form.kind} onChange={set('kind')}>
            {KINDS.map((k) => <option key={k} value={k}>{t(`tags.kind.${k}`)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="tag-count">{t('tags.count')}</label>
          <input id="tag-count" type="number" min={1} max={20} value={form.count} onChange={set('count')} />
        </div>
        <OrgSelect id="tag-org" orgs={orgs} value={form.orgId} onChange={(orgId) => setForm((f) => ({ ...f, orgId }))} />
      </div>
      <label htmlFor="tag-message">{t('tags.message')}</label>
      <textarea id="tag-message" rows={2} maxLength={300} placeholder={t('tags.messagePlaceholder')} value={form.message} onChange={set('message')} />
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={!form.name.trim()}>{t('tags.create')}</button>
    </form>
  );
}

function ClaimForm({ orgs, onClaimed }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ code: '', claimCode: '', name: '', kind: 'keys', orgId: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setDone(false);
    try {
      const tag = await claimTag({ ...form, orgId: form.orgId || undefined, name: form.name.trim() });
      setForm({ code: '', claimCode: '', name: '', kind: 'keys', orgId: '' });
      setDone(true);
      onClaimed(tag);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{t('tags.claimTitle')}</h2>
      <p className="hint">{t('tags.claimIntro')}</p>
      <div className="form-grid">
        <div>
          <label htmlFor="claim-tag">{t('tags.code')}</label>
          <input id="claim-tag" className="mono" required maxLength={12} placeholder="ABCD-2345" value={form.code} onChange={set('code')} />
        </div>
        <div>
          <label htmlFor="claim-code-tag">{t('tags.claimCode')}</label>
          <input id="claim-code-tag" className="mono" required maxLength={10} value={form.claimCode} onChange={set('claimCode')} />
        </div>
        <div>
          <label htmlFor="claim-name">{t('tags.name')}</label>
          <input id="claim-name" required maxLength={40} value={form.name} onChange={set('name')} />
        </div>
        <div>
          <label htmlFor="claim-kind">{t('tags.kind')}</label>
          <select id="claim-kind" value={form.kind} onChange={set('kind')}>
            {KINDS.map((k) => <option key={k} value={k}>{t(`tags.kind.${k}`)}</option>)}
          </select>
        </div>
        <OrgSelect id="claim-org" orgs={orgs} value={form.orgId} onChange={(orgId) => setForm((f) => ({ ...f, orgId }))} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {done && <p className="ok-text" role="status">{t('tags.claimed')}</p>}
      <button type="submit" className="primary">{t('tags.claim')}</button>
    </form>
  );
}

function TagRow({ tag, orgName, selected, onSelect, onChange, onRemoved, onOpenThreads }) {
  const { lang, t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name ?? '');
  const [message, setMessage] = useState(tag.message ?? '');
  const [error, setError] = useState('');
  const act = (fn) => fn().catch((err) => setError(errorText(err)));

  return (
    <li className={`tag-row ${tag.status === 'lost' ? 'tag-lost' : ''}`}>
      <label className="inline">
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={t('tags.print')} />
      </label>
      <div className="tag-main">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                onChange(await updateTag(tag.id, { name: name.trim(), message: message.trim() }));
                setEditing(false);
              });
            }}
          >
            <input aria-label={t('tags.name')} maxLength={40} required value={name} onChange={(e) => setName(e.target.value)} />
            <textarea aria-label={t('tags.message')} rows={2} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} />
            <div className="actions spaced-top">
              <button type="submit" className="primary-inline">{t('tags.save')}</button>
              <button type="button" className="link" onClick={() => setEditing(false)}>{t('tags.cancel')}</button>
            </div>
          </form>
        ) : (
          <>
            <strong>{tag.name}</strong>{' '}
            <span className={`badge ${tag.status === 'lost' ? 'badge-lost' : 'badge-done'}`}>{t(`tags.status.${tag.status}`)}</span>
            {tag.unreadThreads > 0 && (
              <button className="link unread-link" onClick={onOpenThreads}>{t('tags.unread', { count: tag.unreadThreads })}</button>
            )}
            <small className="block">
              {t(`tags.kind.${tag.kind}`)} · <span className="mono">{formatCode(tag.code)}</span>
              {orgName ? ` · ${orgName}` : ''} · {t('tags.scans', { count: tag.scans })}
              {tag.lastScanAt ? ` (${t('tags.lastScan', { time: timeAgo(tag.lastScanAt, lang, t) })})` : ''}
            </small>
            {tag.message && <small className="block">“{tag.message}”</small>}
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {!editing && (
        <div className="actions tag-actions">
          {tag.status === 'lost' ? (
            <button className="primary-inline" onClick={() => act(async () => onChange(await updateTag(tag.id, { status: 'active' })))}>{t('tags.markFound')}</button>
          ) : (
            <button className="danger" onClick={() => act(async () => onChange(await updateTag(tag.id, { status: 'lost' })))}>{t('tags.markLost')}</button>
          )}
          <button onClick={() => setEditing(true)}>{t('tags.edit')}</button>
          <a className="tab-link" href={`/t/${tag.code}`} target="_blank" rel="noreferrer" title={dateTime(tag.createdAt, lang)}>{t('tags.openPage')}</a>
          <button
            className="link danger-text"
            onClick={() => window.confirm(t('tags.offConfirm', { name: tag.name })) && act(async () => { await disableTag(tag.id); onRemoved(tag.id); })}
          >
            {t('tags.off')}
          </button>
        </div>
      )}
    </li>
  );
}

function Threads({ tags, threads, onChange }) {
  const { lang, t } = useI18n();
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState('');
  const tagName = (id) => tags.find((x) => x.id === id)?.name ?? '—';

  async function send(thread) {
    setError('');
    try {
      const res = await replyThread(thread.id, drafts[thread.id].trim());
      onChange(res.thread);
      setDrafts((d) => ({ ...d, [thread.id]: '' }));
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section className="card" id="tag-threads">
      <h2>{t('tags.conversations')}</h2>
      {threads.length === 0 && <p className="hint">{t('tags.noConversations')}</p>}
      {threads.map((th) => (
        <article key={th.id} className={`thread ${th.unread ? 'thread-unread' : ''}`} onClick={() => th.unread && readThread(th.id).then(onChange).catch(() => {})}>
          <header className="item-head">
            <strong>{tagName(th.tagId)}</strong>
            <span className="hint">{th.status === 'closed' ? t('tags.closed') : timeAgo(th.lastMessageAt, lang, t)}</span>
          </header>
          {th.finderPhone && <p className="hint">{t('tags.finderPhone', { phone: th.finderPhone })}</p>}
          <ul className="chat">
            {th.messages.map((m) => (
              <li key={m.id} className={m.from === 'owner' ? 'mine' : 'theirs'}>
                <small>{m.from === 'owner' ? t('tags.you') : t('tags.finder')} · {dateTime(m.at, lang)}</small>
                <p>{m.text}</p>
                {m.location && (
                  <a href={`https://www.openstreetmap.org/?mlat=${m.location.lat}&mlon=${m.location.lng}#map=17/${m.location.lat}/${m.location.lng}`} target="_blank" rel="noreferrer">
                    {t('tags.where')}
                  </a>
                )}
              </li>
            ))}
          </ul>
          {th.status === 'open' && (
            <>
              <form className="message-form" onSubmit={(e) => { e.preventDefault(); send(th); }}>
                <input
                  aria-label={t('tags.reply')}
                  placeholder={t('tags.reply')}
                  maxLength={500}
                  value={drafts[th.id] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [th.id]: e.target.value }))}
                />
                <button type="submit" disabled={!(drafts[th.id] ?? '').trim()}>{t('tags.send')}</button>
              </form>
              <p className="hint">{th.finderReachableBySms ? t('tags.smsNote') : t('tags.pageNote')}</p>
              <button className="link" onClick={() => closeThread(th.id).then(onChange).catch((err) => setError(errorText(err)))}>{t('tags.close')}</button>
            </>
          )}
        </article>
      ))}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

export default function Tags() {
  const { t } = useI18n();
  const labels = useStickerLabels();
  const [tags, setTags] = useState(null);
  const [threads, setThreads] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [printing, setPrinting] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    listTags().then(setTags).catch((err) => setError(err.message));
    listThreads().then(setThreads).catch(() => {});
  }, []);
  usePolling(load, 30000, []);
  useEffect(() => {
    listOrgs().then((list) => setOrgs(list.filter((o) => o.status === 'active'))).catch(() => {});
  }, []);

  if (tags === null) return <p className="center">{error || t('tags.loading')}</p>;

  const toggle = (id) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const orgName = (id) => orgs.find((o) => o.id === id)?.name;
  const toPrint = tags.filter((tag) => selected.has(tag.id));

  return (
    <main className="registry">
      <section className="registry-head">
        <div>
          <h1>{t('tags.title')}</h1>
          <p className="hint">{t('tags.intro')}</p>
        </div>
        <button className="primary-inline" disabled={!toPrint.length} onClick={() => setPrinting(toPrint)}>
          {t('tags.print')}{toPrint.length ? ` (${toPrint.length})` : ''}
        </button>
      </section>

      <section className="card">
        {tags.length === 0 ? (
          <p className="hint">{t('tags.empty')}</p>
        ) : (
          <ul className="tag-list">
            {tags.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                orgName={orgName(tag.orgId)}
                selected={selected.has(tag.id)}
                onSelect={() => toggle(tag.id)}
                onChange={(updated) => setTags((list) => list.map((x) => (x.id === updated.id ? updated : x)))}
                onRemoved={(id) => setTags((list) => list.filter((x) => x.id !== id))}
                onOpenThreads={() => document.getElementById('tag-threads')?.scrollIntoView({ behavior: 'smooth' })}
              />
            ))}
          </ul>
        )}
      </section>

      <div className="item-grid">
        <NewTags
          orgs={orgs}
          onCreated={(created) => {
            setTags((list) => [...created, ...list]);
            setSelected(new Set(created.map((x) => x.id)));
          }}
        />
        <ClaimForm orgs={orgs} onClaimed={(tag) => setTags((list) => [tag, ...list])} />
      </div>

      <Threads tags={tags} threads={threads} onChange={(th) => setThreads((list) => list.map((x) => (x.id === th.id ? th : x)))} />

      {printing && <StickerSheet title={t('tags.print')} tags={printing} labels={labels} onClose={() => setPrinting(null)} />}
    </main>
  );
}
