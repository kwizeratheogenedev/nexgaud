import { useCallback, useEffect, useState } from 'react';
import {
  addPartnerMember,
  adminAudit,
  adminCloseReport,
  adminDisputes,
  adminPartners,
  adminRegistryStats,
  adminReports,
  adminSearchItems,
  adminUpload,
  createPartner,
  openBlob,
  removePartnerMember,
  resolveDispute,
  reviewReport,
  updatePartner,
} from '../api.js';
import { dateTime, timeAgo } from '../format.js';

// For the NexGuard team (English only, like the pilot statistics).
const SECTIONS = [
  ['reviews', 'Reviews'],
  ['disputes', 'Disputes'],
  ['partners', 'Partners'],
  ['stats', 'Statistics'],
  ['search', 'Search'],
  ['audit', 'Audit log'],
];
const ago = (v) => timeAgo(v, 'en', (k) => ({ never: 'never', justNow: 'just now' })[k] ?? k);
const when = (v) => dateTime(v, 'en');
const errorText = (err) => (err.details ? Object.values(err.details).flat()[0] : err.message);
const person = (u) => (u ? `${u.name ?? 'No name'} · ${u.phone}` : '—');
const itemLabel = (i) => (i ? [i.brand, i.model].filter(Boolean).join(' ') : '—');

function useLoad(fn, deps) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    return fn().then(setData).catch((err) => setError(err.message));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, load };
}

function FileButtons({ ids, labels }) {
  const [error, setError] = useState('');
  if (!ids.length) return <span className="hint">No files</span>;
  return (
    <span className="actions">
      {ids.map((id, i) => (
        <button key={id} className="link" onClick={() => adminUpload(id).then(openBlob).catch((err) => setError(err.message))}>
          {labels?.[i] ?? `File ${i + 1}`}
        </button>
      ))}
      {error && <span className="error">{error}</span>}
    </span>
  );
}

function ItemFacts({ item }) {
  if (!item) return null;
  return (
    <dl>
      <dt>Device</dt>
      <dd>{itemLabel(item)}{item.color ? ` · ${item.color}` : ''} ({item.kind})</dd>
      <dt>IMEI / serial</dt>
      <dd className="mono">{[...item.imeis, item.serial].filter(Boolean).join(' · ')}</dd>
      <dt>Registered</dt>
      <dd>{when(item.createdAt)}</dd>
      <dt>Proof</dt>
      <dd>
        {item.proofStatus}{' '}
        <FileButtons ids={item.proofs.map((p) => p.uploadId)} labels={item.proofs.map((p) => p.kind)} />
      </dd>
    </dl>
  );
}

function ReviewCard({ report, onDone }) {
  const [note, setNote] = useState('');
  const [proof, setProof] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function decide(decision) {
    setBusy(true);
    setError('');
    try {
      await reviewReport(report.id, { decision, ...(note.trim() ? { note: note.trim() } : {}), ...(proof ? { proof } : {}) });
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <article className="card review-card">
      <header className="item-head">
        <h3>{report.type === 'stolen' ? 'Stolen' : 'Lost'}: {itemLabel(report.item)}</h3>
        <span className="hint">sent {ago(report.createdAt)}</span>
      </header>
      <dl>
        <dt>Owner</dt>
        <dd>{person(report.owner)} · {report.ownerReports} report(s) in total</dd>
        <dt>When / where</dt>
        <dd>{when(report.incidentAt)} · {report.place}</dd>
        <dt>Police case</dt>
        <dd>{report.policeCaseNumber ?? <span className="bad-text">none</span>}{report.policeStation ? ` · ${report.policeStation}` : ''}</dd>
        {report.description && (
          <>
            <dt>Details</dt>
            <dd>{report.description}</dd>
          </>
        )}
        <dt>Checks so far</dt>
        <dd>{report.item?.checks ?? 0}</dd>
      </dl>
      <ItemFacts item={report.item} />
      <p className="hint">Before approving: call the owner, confirm the case number with the police station, and compare the IMEI on the proof with the registered one.</p>
      <label htmlFor={`note-${report.id}`}>Note to the owner (needed to reject)</label>
      <textarea id={`note-${report.id}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      {report.item?.proofs.length > 0 && (
        <>
          <label htmlFor={`proof-${report.id}`}>Proof of ownership</label>
          <select id={`proof-${report.id}`} value={proof} onChange={(e) => setProof(e.target.value)}>
            <option value="">Leave as it is</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Not accepted</option>
          </select>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions spaced-top">
        <button className="primary-inline" disabled={busy} onClick={() => decide('approve')}>Approve: show as {report.type}</button>
        <button className="danger" disabled={busy || !note.trim()} onClick={() => decide('reject')}>Reject</button>
      </div>
    </article>
  );
}

function Reviews() {
  const [status, setStatus] = useState('pending');
  const { data, error, load } = useLoad(() => adminReports(status), [status]);
  const [closeError, setCloseError] = useState('');

  async function close(report, reason) {
    if (!window.confirm(`Close this report as ${reason}? Checks will show the device as registered again.`)) return;
    try {
      await adminCloseReport(report.id, { reason });
      load();
    } catch (err) {
      setCloseError(errorText(err));
    }
  }

  return (
    <>
      <div className="actions">
        {['pending', 'approved', 'rejected', 'closed'].map((s) => (
          <button key={s} className={status === s ? 'chip active' : 'chip'} onClick={() => setStatus(s)}>{s}</button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {closeError && <p className="error">{closeError}</p>}
      {data?.length === 0 && <p className="hint">Nothing here.</p>}
      {status === 'pending' ? (
        <div className="item-grid">
          {data?.map((r) => <ReviewCard key={r.id} report={r} onDone={load} />)}
        </div>
      ) : (
        <div className="table-wrap card">
          <table className="table">
            <thead>
              <tr><th>Device</th><th>Owner</th><th>Type</th><th>Police case</th><th>Reviewed</th><th /></tr>
            </thead>
            <tbody>
              {data?.map((r) => (
                <tr key={r.id}>
                  <td>{itemLabel(r.item)}<small className="block mono">{r.item?.imeis[0] ?? r.item?.serial}</small></td>
                  <td>{person(r.owner)}</td>
                  <td>{r.type}{r.closedReason ? ` (${r.closedReason})` : ''}</td>
                  <td>{r.policeCaseNumber ?? '—'}</td>
                  <td>{r.reviewedAt ? ago(r.reviewedAt) : '—'}{r.reviewNote ? <small className="block">{r.reviewNote}</small> : null}</td>
                  <td>
                    {status === 'approved' && (
                      <span className="actions">
                        <button className="link" onClick={() => close(r, 'recovered')}>Recovered</button>
                        <button className="link" onClick={() => close(r, 'withdrawn')}>Withdrawn</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function DisputeCard({ dispute, onDone }) {
  const [outcome, setOutcome] = useState('rejected');
  const [action, setAction] = useState('none');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (action === 'transfer_item' && !window.confirm('Give this device to the claimant? The current owner loses it from their account.')) return;
    setBusy(true);
    setError('');
    try {
      await resolveDispute(dispute.id, { outcome, action: outcome === 'upheld' ? action : 'none', note: note.trim() });
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <article className="card review-card">
      <header className="item-head">
        <h3>{dispute.reason === 'ownership' ? '"This device is mine"' : '"Bought legally, shows as reported"'}</h3>
        <span className="hint">opened {ago(dispute.createdAt)}</span>
      </header>
      <blockquote>{dispute.message}</blockquote>
      <dl>
        <dt>Claimant</dt>
        <dd>{person(dispute.claimant)}</dd>
        <dt>Evidence</dt>
        <dd><FileButtons ids={dispute.evidence} /></dd>
        <dt>Registered owner</dt>
        <dd>{person(dispute.owner)}</dd>
        <dt>Open report</dt>
        <dd>{dispute.openReport ? `${dispute.openReport.type}, ${dispute.openReport.status} · case ${dispute.openReport.policeCaseNumber ?? '—'}` : 'none'}</dd>
      </dl>
      <ItemFacts item={dispute.item} />
      {dispute.status === 'open' ? (
        <form onSubmit={submit}>
          <fieldset className="choice">
            <legend>Decision</legend>
            <label className="inline"><input type="radio" name={`o-${dispute.id}`} checked={outcome === 'rejected'} onChange={() => setOutcome('rejected')} /> Reject</label>
            <label className="inline"><input type="radio" name={`o-${dispute.id}`} checked={outcome === 'upheld'} onChange={() => setOutcome('upheld')} /> Uphold</label>
          </fieldset>
          {outcome === 'upheld' && (
            <>
              <label htmlFor={`a-${dispute.id}`}>Then</label>
              <select id={`a-${dispute.id}`} value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="none">Change nothing in the registry</option>
                <option value="close_report" disabled={!dispute.openReport}>Close the stolen/lost report</option>
                <option value="transfer_item">Give the device to the claimant</option>
              </select>
            </>
          )}
          <label htmlFor={`n-${dispute.id}`}>Reason (sent to both people)</label>
          <textarea id={`n-${dispute.id}`} rows={2} minLength={3} maxLength={500} required value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="primary" disabled={busy || note.trim().length < 3}>Save decision</button>
        </form>
      ) : (
        <p className="hint">{dispute.status} · {dispute.action} · {dispute.resolution}</p>
      )}
    </article>
  );
}

function Disputes() {
  const [status, setStatus] = useState('open');
  const { data, error, load } = useLoad(() => adminDisputes(status), [status]);
  return (
    <>
      <div className="actions">
        {['open', 'upheld', 'rejected'].map((s) => (
          <button key={s} className={status === s ? 'chip active' : 'chip'} onClick={() => setStatus(s)}>{s}</button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {data?.length === 0 && <p className="hint">Nothing here.</p>}
      <div className="item-grid">{data?.map((d) => <DisputeCard key={d.id} dispute={d} onDone={load} />)}</div>
    </>
  );
}

function PartnerCard({ partner, stats, onChange }) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const act = (fn) => fn().then(onChange).catch((err) => setError(errorText(err)));

  return (
    <article className="card">
      <header className="item-head">
        <div>
          <h3>{partner.name}</h3>
          <p className="hint">{partner.type}{partner.district ? ` · ${partner.district}` : ''}{partner.contactPhone ? ` · ${partner.contactPhone}` : ''}</p>
        </div>
        <span className={`badge ${partner.status === 'active' ? 'badge-done' : 'badge-failed'}`}>{partner.status}</span>
      </header>
      {stats && (
        <p className="hint">
          {stats.checks7d} checks this week ({stats.flagged7d} reported) · {stats.checks30d} in 30 days · last {ago(stats.lastCheckAt)}
        </p>
      )}
      <h3>Members</h3>
      {partner.members.length === 0 ? (
        <p className="hint">No members yet.</p>
      ) : (
        <ul className="commands">
          {partner.members.map((m) => (
            <li key={m.id}>
              <span>{person(m)}</span>
              <button className="link danger-text" onClick={() => window.confirm(`Remove ${m.phone}? They are signed out.`) && act(() => removePartnerMember(partner.id, m.id))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <form className="message-form" onSubmit={(e) => { e.preventDefault(); act(() => addPartnerMember(partner.id, { phone }).then(() => setPhone(''))); }}>
        <input type="tel" placeholder="Member's phone" aria-label="Member's phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button type="submit" disabled={!phone.trim()}>Add member</button>
      </form>
      <p className="hint">{partner.apiKeys.length} active API key(s)</p>
      <button className="link" onClick={() => act(() => updatePartner(partner.id, { status: partner.status === 'active' ? 'suspended' : 'active' }))}>
        {partner.status === 'active' ? 'Suspend' : 'Reactivate'}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}

function Partners() {
  const { data, error, load } = useLoad(() => Promise.all([adminPartners(), adminRegistryStats()]), []);
  const [form, setForm] = useState({ name: '', type: 'shop', district: '', contactPhone: '' });
  const [formError, setFormError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function create(e) {
    e.preventDefault();
    setFormError('');
    try {
      await createPartner(Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim())));
      setForm({ name: '', type: 'shop', district: '', contactPhone: '' });
      load();
    } catch (err) {
      setFormError(errorText(err));
    }
  }

  const [partners, stats] = data ?? [[], null];
  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="item-grid">
        {partners.map((p) => (
          <PartnerCard key={p.id} partner={p} stats={stats?.partners.find((s) => s.id === p.id)} onChange={load} />
        ))}
        <form className="card" onSubmit={create}>
          <h3>Add a partner</h3>
          <label htmlFor="p-name">Name</label>
          <input id="p-name" required minLength={2} maxLength={80} value={form.name} onChange={set('name')} />
          <label htmlFor="p-type">Type</label>
          <select id="p-type" value={form.type} onChange={set('type')}>
            <option value="shop">Phone shop</option>
            <option value="repair">Repair shop</option>
            <option value="police">Police</option>
            <option value="other">Other</option>
          </select>
          <label htmlFor="p-district">District</label>
          <input id="p-district" maxLength={40} value={form.district} onChange={set('district')} />
          <label htmlFor="p-phone">Contact phone</label>
          <input id="p-phone" type="tel" maxLength={20} value={form.contactPhone} onChange={set('contactPhone')} />
          {formError && <p className="error" role="alert">{formError}</p>}
          <button type="submit" className="primary">Add partner</button>
        </form>
      </div>
    </>
  );
}

function Stat({ label, value, note, tone }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function Stats() {
  const { data: s, error } = useLoad(adminRegistryStats, []);
  if (error) return <p className="error">{error}</p>;
  if (!s) return <p className="hint">Loading…</p>;
  const rows = (obj) => Object.entries(obj);
  return (
    <>
      <section className={`card gate ${s.gate.passed ? 'passed' : ''}`}>
        <h2>Phase 3 gate: {s.gate.passed ? 'passed' : 'not yet'}</h2>
        <p className="hint">{s.gate.target} partner shops checking phones every week (at least one check in the last 7 days).</p>
        <div className="stats">
          <Stat label="Shops active this week" value={`${s.gate.activeShops} / ${s.gate.target}`} tone={s.gate.passed ? 'good' : ''} />
          <Stat label="Registered devices" value={s.items} note={`${s.itemStatuses.stolen ?? 0} stolen · ${s.itemStatuses.lost ?? 0} lost`} />
          <Stat label="Reports to review" value={s.reports.pending ?? 0} tone={(s.reports.pending ?? 0) > 0 ? 'bad' : ''} />
          <Stat label="Open disputes" value={s.openDisputes} tone={s.openDisputes > 0 ? 'bad' : ''} />
        </div>
      </section>
      <div className="pilot-grid">
        <section className="card">
          <h2>Checks, last 7 days</h2>
          <table className="table">
            <tbody>
              {rows(s.checks7d.bySource).map(([k, v]) => <tr key={k}><td>{k.replace('_', ' ')}</td><td className="num">{v}</td></tr>)}
            </tbody>
          </table>
          <h2 className="spaced">Results</h2>
          <table className="table">
            <tbody>
              {rows(s.checks7d.byResult).map(([k, v]) => <tr key={k}><td>{k.replace('_', ' ')}</td><td className="num">{v}</td></tr>)}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2>Partners</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Partner</th><th className="num">7 days</th><th className="num">Reported</th><th className="num">30 days</th><th>Last check</th></tr>
              </thead>
              <tbody>
                {s.partners.map((p) => (
                  <tr key={p.id} className={p.checks7d === 0 && p.type !== 'police' ? 'row-warn' : ''}>
                    <td>{p.name}<small className="block">{p.type}{p.status !== 'active' ? ' · suspended' : ''}</small></td>
                    <td className="num">{p.checks7d}</td>
                    <td className="num">{p.flagged7d}</td>
                    <td className="num">{p.checks30d}</td>
                    <td>{ago(p.lastCheckAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function Search() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  return (
    <section className="card">
      <form className="message-form" onSubmit={(e) => { e.preventDefault(); setError(''); adminSearchItems(q.trim()).then(setItems).catch((err) => setError(errorText(err))); }}>
        <input aria-label="IMEI, serial or owner's phone" placeholder="IMEI, serial or owner's phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" disabled={q.trim().length < 3}>Search</button>
      </form>
      {error && <p className="error">{error}</p>}
      {items?.length === 0 && <p className="hint">Nothing found.</p>}
      {items?.map((i) => (
        <div key={i.id} className="search-hit">
          <h3>{itemLabel(i)} <span className={`badge badge-item-${i.status}`}>{i.status}</span></h3>
          <p className="hint">Owner: {person(i.owner)}</p>
          <ItemFacts item={i} />
          {i.reports.length > 0 && (
            <ul className="commands">
              {i.reports.map((r) => (
                <li key={r.id}><span>{r.type} · {r.status}{r.closedReason ? ` (${r.closedReason})` : ''}</span><small>{when(r.createdAt)} · {r.place} · {r.policeCaseNumber ?? 'no case'}</small></li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

function Audit() {
  const [action, setAction] = useState('');
  const [entries, setEntries] = useState([]);
  const [more, setMore] = useState(true);
  const [error, setError] = useState('');

  const fetchPage = useCallback(
    (before) =>
      adminAudit({ action, before, limit: 50 })
        .then((page) => {
          setEntries((cur) => (before ? [...cur, ...page] : page));
          setMore(page.length === 50);
        })
        .catch((err) => setError(err.message)),
    [action],
  );
  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  return (
    <section className="card">
      <div className="actions">
        {['', 'item', 'report', 'dispute', 'transfer', 'partner', 'upload'].map((a) => (
          <button key={a || 'all'} className={action === a ? 'chip active' : 'chip'} onClick={() => setAction(a)}>{a || 'all'}</button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>When</th><th>Action</th><th>By</th><th>Details</th></tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td title={when(e.createdAt)}>{ago(e.createdAt)}</td>
                <td className="mono">{e.action}</td>
                <td>{e.actor ? person(e.actor) : e.partner ?? '—'}<small className="block">{e.actorRole}{e.partner ? ` · ${e.partner}` : ''}</small></td>
                <td className="mono small">{e.details ? JSON.stringify(e.details) : ''}{e.targetId ? <small className="block">{e.targetType} {e.targetId}</small> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more && entries.length > 0 && (
        <button className="spaced-top" onClick={() => fetchPage(entries.at(-1).createdAt)}>Load older</button>
      )}
    </section>
  );
}

export default function AdminRegistry() {
  const [section, setSection] = useState('reviews');
  const View = { reviews: Reviews, disputes: Disputes, partners: Partners, stats: Stats, search: Search, audit: Audit }[section];
  return (
    <main className="pilot">
      <nav className="tabs sub-tabs" aria-label="Registry admin">
        {SECTIONS.map(([key, label]) => (
          <button key={key} className={section === key ? 'active' : ''} onClick={() => setSection(key)}>{label}</button>
        ))}
      </nav>
      <View />
    </main>
  );
}
