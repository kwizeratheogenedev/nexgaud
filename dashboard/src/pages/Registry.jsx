import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addEvidence,
  cancelTransfer,
  claimItem,
  closeReport,
  deleteItem,
  deleteProof,
  getProof,
  listDisputes,
  listRegistry,
  openBlob,
  openDispute,
  registerItem,
  reportItem,
  startTransfer,
  updateItem,
  uploadProof,
} from '../api.js';
import { dateTime } from '../format.js';
import { useI18n } from '../i18n.jsx';

const KINDS = ['phone', 'tablet', 'laptop', 'other'];
const PROOF_KINDS = ['box', 'receipt', 'other'];

/** The first useful message from an API error (field errors first). */
const errorText = (err) => (err.details ? Object.values(err.details).flat()[0] : err.message);
const label = (item) => [item.brand, item.model].filter(Boolean).join(' ');
// datetime-local wants local time, not UTC.
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/** Same rules as the API (15 digits, Luhn check digit), so the reason can be shown in the user's language. */
function imeiProblem(value) {
  const digits = value.replace(/^imei\s*[:#]?\s*/i, '');
  if (!/^[\d\s\-/.]+$/.test(digits)) return 'format';
  const d = digits.replace(/\D/g, '');
  if (d.length === 16) return 'imeisv';
  if (d.length !== 15) return 'length';
  if (/^(\d){14}$/.test(d)) return 'placeholder';
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let n = Number(d[14 - i]);
    if (i % 2 === 1) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
    sum += n;
  }
  return sum % 10 === 0 ? null : 'checksum';
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (err) {
      setError(errorText(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

function RegisterForm({ devices, onDone, onCancel, onTaken }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const [form, setForm] = useState({ kind: 'phone', brand: '', model: '', color: '', imei1: '', imei2: '', serial: '', deviceId: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const needsImei = form.kind === 'phone' || form.kind === 'tablet';

  async function submit(e) {
    e.preventDefault();
    const body = {
      kind: form.kind,
      brand: form.brand.trim(),
      ...(form.model.trim() ? { model: form.model.trim() } : {}),
      ...(form.color.trim() ? { color: form.color.trim() } : {}),
      imeis: [form.imei1, form.imei2].map((v) => v.trim()).filter(Boolean),
      ...(form.serial.trim() ? { serial: form.serial.trim() } : {}),
      ...(form.deviceId ? { deviceId: form.deviceId } : {}),
    };
    const item = await run(async () => {
      const problem = body.imeis.map(imeiProblem).find(Boolean);
      if (problem) throw new Error(t(`check.reason.${problem}`));
      try {
        return await registerItem(body);
      } catch (err) {
        if (err.code !== 'already_registered') throw err;
        // Someone else registered it: offer a dispute, with the number filled in.
        onTaken(body.imeis[0] ?? body.serial);
        throw new Error(t('reg.alreadyRegistered'));
      }
    });
    if (item) onDone(item);
  }

  return (
    <form className="card reg-form" onSubmit={submit}>
      <h2>{t('reg.add')}</h2>
      <div className="form-grid">
        <div>
          <label htmlFor="reg-kind">{t('reg.kind')}</label>
          <select id="reg-kind" value={form.kind} onChange={set('kind')}>
            {KINDS.map((k) => <option key={k} value={k}>{t(`reg.kind.${k}`)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="reg-brand">{t('reg.brand')}</label>
          <input id="reg-brand" required maxLength={40} placeholder="TECNO" value={form.brand} onChange={set('brand')} />
        </div>
        <div>
          <label htmlFor="reg-model">{t('reg.model')}</label>
          <input id="reg-model" maxLength={60} placeholder="Spark 20" value={form.model} onChange={set('model')} />
        </div>
        <div>
          <label htmlFor="reg-color">{t('reg.color')}</label>
          <input id="reg-color" maxLength={30} value={form.color} onChange={set('color')} />
        </div>
      </div>
      {needsImei && (
        <div className="form-grid">
          <div>
            <label htmlFor="reg-imei1">{t('reg.imei1')}</label>
            <input id="reg-imei1" className="mono" inputMode="numeric" maxLength={24} value={form.imei1} onChange={set('imei1')} required={!form.serial.trim()} />
          </div>
          <div>
            <label htmlFor="reg-imei2">{t('reg.imei2')}</label>
            <input id="reg-imei2" className="mono" inputMode="numeric" maxLength={24} value={form.imei2} onChange={set('imei2')} />
          </div>
        </div>
      )}
      {needsImei && <p className="hint">{t('reg.imeiHint')}</p>}
      <div className="form-grid">
        <div>
          <label htmlFor="reg-serial">{t('reg.serial')}</label>
          <input id="reg-serial" className="mono" maxLength={40} value={form.serial} onChange={set('serial')} required={!needsImei} />
          {!needsImei && <p className="hint">{t('reg.serialHint')}</p>}
        </div>
        {devices?.length > 0 && form.kind === 'phone' && (
          <div>
            <label htmlFor="reg-device">{t('reg.linkDevice')}</label>
            <select id="reg-device" value={form.deviceId} onChange={set('deviceId')}>
              <option value="">{t('reg.noLink')}</option>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions spaced-top">
        <button type="submit" className="primary-inline" disabled={busy || !form.brand.trim()}>{t('reg.save')}</button>
        <button type="button" className="link" onClick={onCancel}>{t('reg.cancel')}</button>
      </div>
    </form>
  );
}

function ReportForm({ item, onDone, onCancel }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const [form, setForm] = useState({ type: 'stolen', incidentAt: today(), place: '', description: '', policeCaseNumber: '', policeStation: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim?.() !== ''));
    body.incidentAt = new Date(form.incidentAt).toISOString();
    const updated = await run(() => reportItem(item.id, body));
    if (updated) onDone(updated);
  }

  return (
    <form className="report-form" onSubmit={submit}>
      <h3>{t('reg.reportStolen')}</h3>
      <fieldset className="choice">
        <legend>{t('reg.reportType')}</legend>
        {['stolen', 'lost'].map((type) => (
          <label key={type} className="inline">
            <input type="radio" name={`type-${item.id}`} value={type} checked={form.type === type} onChange={set('type')} /> {t(`reg.type.${type}`)}
          </label>
        ))}
      </fieldset>
      <div className="form-grid">
        <div>
          <label htmlFor={`when-${item.id}`}>{t('reg.incidentAt')}</label>
          <input id={`when-${item.id}`} type="datetime-local" max={today()} required value={form.incidentAt} onChange={set('incidentAt')} />
        </div>
        <div>
          <label htmlFor={`where-${item.id}`}>{t('reg.place')}</label>
          <input id={`where-${item.id}`} required minLength={2} maxLength={120} value={form.place} onChange={set('place')} />
        </div>
        <div>
          <label htmlFor={`case-${item.id}`}>{t('reg.caseNumber')}</label>
          <input id={`case-${item.id}`} maxLength={40} required={form.type === 'stolen'} value={form.policeCaseNumber} onChange={set('policeCaseNumber')} />
        </div>
        <div>
          <label htmlFor={`station-${item.id}`}>{t('reg.station')}</label>
          <input id={`station-${item.id}`} maxLength={80} value={form.policeStation} onChange={set('policeStation')} />
        </div>
      </div>
      {form.type === 'stolen' && <p className="hint">{t('reg.caseHint')}</p>}
      <label htmlFor={`desc-${item.id}`}>{t('reg.description')}</label>
      <textarea id={`desc-${item.id}`} rows={2} maxLength={1000} value={form.description} onChange={set('description')} />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions spaced-top">
        <button type="submit" className="danger" disabled={busy}>{t('reg.sendReport')}</button>
        <button type="button" className="link" onClick={onCancel}>{t('reg.cancel')}</button>
      </div>
    </form>
  );
}

function Proofs({ item, onChange }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const [kind, setKind] = useState('box');
  const input = useRef(null);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const updated = await run(() => uploadProof(item.id, kind, file));
    if (updated) onChange(updated);
  }

  return (
    <div className="item-section">
      <h3>{t('reg.proofs')} <span className={`badge badge-proof-${item.proofStatus}`}>{t(`reg.proofStatus.${item.proofStatus}`)}</span></h3>
      <p className="hint">{t('reg.proofsHint')}</p>
      {item.proofs.length > 0 && (
        <ul className="proofs">
          {item.proofs.map((p) => (
            <li key={p.id}>
              <span>{t(`reg.proofKind.${p.kind}`)} · {Math.max(1, Math.round(p.size / 1024))} KB</span>
              <button className="link" onClick={() => run(async () => openBlob(await getProof(item.id, p.id)))}>{t('reg.view')}</button>
              <button className="link danger-text" onClick={() => run(async () => onChange(await deleteProof(item.id, p.id)))}>{t('reg.remove')}</button>
            </li>
          ))}
        </ul>
      )}
      {item.proofs.length < 4 && (
        <div className="actions">
          <select aria-label={t('reg.proofKind')} value={kind} onChange={(e) => setKind(e.target.value)}>
            {PROOF_KINDS.map((k) => <option key={k} value={k}>{t(`reg.proofKind.${k}`)}</option>)}
          </select>
          <button type="button" onClick={() => input.current?.click()} disabled={busy}>{busy ? t('reg.uploading') : t('reg.addProof')}</button>
          <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={pick} />
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

function ReportStatus({ item, onChange }) {
  const { lang, t } = useI18n();
  const { busy, error, run } = useAction();
  const report = item.report;
  if (!report || report.status === 'closed') return null;
  const close = (reason) => run(async () => onChange(await closeReport(item.id, reason)));

  return (
    <div className={`item-section report-box report-${report.status}`}>
      <h3>{report.status === 'approved' ? t(`reg.status.${item.status}`) : t(`reg.report.${report.status}`)}</h3>
      <p className="hint">
        {t(`reg.type.${report.type}`)} · {dateTime(report.incidentAt, lang)} · {report.place}
        {report.policeCaseNumber ? ` · ${report.policeCaseNumber}` : ''}
      </p>
      {report.status === 'pending' && <p className="hint">{t('reg.pendingHint')}</p>}
      {report.status === 'approved' && <p className="hint">{t('reg.approvedHint')}</p>}
      {report.reviewNote && <p>{t('reg.reviewNote', { note: report.reviewNote })}</p>}
      {report.status !== 'rejected' && (
        <div className="actions">
          <button className="primary-inline" onClick={() => close('recovered')} disabled={busy}>{t('reg.found')}</button>
          <button className="link" onClick={() => close('withdrawn')} disabled={busy}>{t('reg.withdraw')}</button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

function Handover({ item, onChange }) {
  const { lang, t } = useI18n();
  const { busy, error, run } = useAction();
  const [code, setCode] = useState(null);

  async function start() {
    const res = await run(() => startTransfer(item.id));
    if (!res) return;
    setCode(res);
    onChange({ ...item, transferExpiresAt: res.expiresAt });
  }
  async function cancel() {
    await run(() => cancelTransfer(item.id));
    setCode(null);
    onChange({ ...item, transferExpiresAt: null });
  }

  return (
    <div className="item-section">
      <h3>{t('reg.sell')}</h3>
      {code ? (
        <>
          <p>{t('reg.code')}: <strong className="mono code-big">{code.code}</strong></p>
          <p className="hint">{t('reg.codeExpires', { date: dateTime(code.expiresAt, lang) })}</p>
        </>
      ) : item.transferExpiresAt ? (
        <p className="hint">{t('reg.codeHidden', { date: dateTime(item.transferExpiresAt, lang) })}</p>
      ) : (
        <p className="hint">{t('reg.sellIntro')}</p>
      )}
      <div className="actions">
        {!code && <button onClick={start} disabled={busy}>{t('reg.makeCode')}</button>}
        {(code || item.transferExpiresAt) && <button className="link" onClick={cancel} disabled={busy}>{t('reg.cancelTransfer')}</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

function ItemCard({ item, devices, onChange, onRemoved }) {
  const { t } = useI18n();
  const { error, run } = useAction();
  const [reporting, setReporting] = useState(false);
  const open = item.report && ['pending', 'approved'].includes(item.report.status);
  const linked = devices?.find((d) => d.id === item.deviceId);

  async function remove() {
    if (!window.confirm(t('reg.deleteConfirm', { name: label(item) }))) return;
    const ok = await run(() => deleteItem(item.id).then(() => true));
    if (ok) onRemoved(item.id);
  }

  return (
    <article className={`card item-card ${item.status !== 'registered' ? 'item-reported' : ''}`}>
      <header className="item-head">
        <div>
          <h2>{label(item)}</h2>
          <p className="hint">
            {t(`reg.kind.${item.kind}`)}
            {item.color ? ` · ${item.color}` : ''}
            {linked ? ` · ${t('reg.linkDevice')}: ${linked.name}` : ''}
          </p>
        </div>
        <span className={`badge badge-item-${item.status}`}>{t(`reg.status.${item.status}`)}</span>
      </header>
      <dl>
        <dt>{t('reg.identifiers')}</dt>
        <dd className="mono">{[...item.imeis, item.serial].filter(Boolean).join(' · ')}</dd>
        {devices?.length > 0 && item.kind === 'phone' && (
          <>
            <dt>{t('reg.linkDevice')}</dt>
            <dd>
              <select
                aria-label={t('reg.linkDevice')}
                value={item.deviceId ?? ''}
                onChange={(e) => run(async () => onChange(await updateItem(item.id, { deviceId: e.target.value || null })))}
              >
                <option value="">{t('reg.noLink')}</option>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </dd>
          </>
        )}
      </dl>

      <ReportStatus item={item} onChange={onChange} />
      {item.report?.status === 'rejected' && item.report.reviewNote && (
        <p className="hint">{t('reg.report.rejected')} · {t('reg.reviewNote', { note: item.report.reviewNote })}</p>
      )}

      {!open &&
        (reporting ? (
          <ReportForm item={item} onCancel={() => setReporting(false)} onDone={(updated) => { setReporting(false); onChange(updated); }} />
        ) : (
          <div className="item-section">
            <button className="danger" onClick={() => setReporting(true)}>{t('reg.reportStolen')}</button>
          </div>
        ))}

      <Proofs item={item} onChange={onChange} />
      {!open && <Handover item={item} onChange={onChange} />}
      {!open && <button className="link danger-link" onClick={remove}>{t('reg.delete')}</button>}
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}

function ClaimForm({ onClaimed }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const item = await run(() => claimItem(identifier.trim(), code.trim().toUpperCase()));
    if (item) {
      setDone(true);
      setIdentifier('');
      setCode('');
      onClaimed(item);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{t('reg.claimTitle')}</h2>
      <p className="hint">{t('reg.claimIntro')}</p>
      <label htmlFor="claim-id">{t('reg.identifier')}</label>
      <input id="claim-id" className="mono" maxLength={40} required value={identifier} onChange={(e) => { setIdentifier(e.target.value); setDone(false); }} />
      <label htmlFor="claim-code">{t('reg.claimCode')}</label>
      <input id="claim-code" className="mono" maxLength={8} minLength={8} required autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      {error && <p className="error" role="alert">{error}</p>}
      {done && <p className="ok-text" role="status">{t('reg.claimed')}</p>}
      <button type="submit" className="primary" disabled={busy}>{t('reg.claim')}</button>
    </form>
  );
}

function Disputes({ prefill }) {
  const { lang, t } = useI18n();
  const { busy, error, run } = useAction();
  const [disputes, setDisputes] = useState([]);
  const [form, setForm] = useState({ identifier: prefill ?? '', reason: 'ownership', message: '' });
  const [sent, setSent] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    listDisputes().then(setDisputes).catch(() => {});
  }, []);
  useEffect(() => {
    if (prefill) setForm((f) => ({ ...f, identifier: prefill, reason: 'ownership' }));
  }, [prefill]);

  async function submit(e) {
    e.preventDefault();
    const dispute = await run(() => openDispute({ ...form, identifier: form.identifier.trim(), message: form.message.trim() }));
    if (dispute) {
      setDisputes((ds) => [dispute, ...ds]);
      setForm({ identifier: '', reason: 'ownership', message: '' });
      setSent(true);
    }
  }

  async function evidence(dispute, file) {
    const updated = await run(() => addEvidence(dispute.id, file));
    if (updated) setDisputes((ds) => ds.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
  }

  return (
    <section className="card" id="disputes">
      <h2>{t('reg.disputeTitle')}</h2>
      <p className="hint">{t('reg.disputeIntro')}</p>
      <form onSubmit={submit}>
        <label htmlFor="dispute-id">{t('reg.identifier')}</label>
        <input id="dispute-id" className="mono" maxLength={40} required value={form.identifier} onChange={set('identifier')} />
        <label htmlFor="dispute-reason">{t('reg.disputeReason')}</label>
        <select id="dispute-reason" value={form.reason} onChange={set('reason')}>
          <option value="ownership">{t('reg.disputeReason.ownership')}</option>
          <option value="report">{t('reg.disputeReason.report')}</option>
        </select>
        <label htmlFor="dispute-message">{t('reg.disputeMessage')}</label>
        <textarea id="dispute-message" rows={3} minLength={10} maxLength={1000} required value={form.message} onChange={set('message')} />
        {error && <p className="error" role="alert">{error}</p>}
        {sent && <p className="ok-text" role="status">{t('reg.disputeSent')}</p>}
        <button type="submit" className="primary" disabled={busy}>{t('reg.sendDispute')}</button>
      </form>

      {disputes.length > 0 && (
        <>
          <h3>{t('reg.disputes')}</h3>
          <ul className="commands">
            {disputes.map((d) => (
              <li key={d.id}>
                <span>{d.device ?? '—'} · {t(`reg.disputeReason.${d.reason}`)}</span>
                <span className={`badge badge-dispute-${d.status}`}>{t(`reg.disputeStatus.${d.status}`)}</span>
                <small>
                  {dateTime(d.createdAt, lang)}
                  {d.evidence?.length ? ` · ${t('reg.evidenceAdded', { count: d.evidence.length })}` : ''}
                  {d.resolution ? ` · ${d.resolution}` : ''}
                </small>
                {d.status === 'open' && (d.evidence?.length ?? 0) < 4 && (
                  <label className="file-link">
                    {t('reg.addEvidence')}
                    <input type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) evidence(d, f); }} />
                  </label>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default function Registry({ devices }) {
  const { t } = useI18n();
  const [items, setItems] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [disputeFor, setDisputeFor] = useState('');

  useEffect(() => {
    listRegistry().then(setItems).catch((err) => setError(err.message));
  }, []);

  const replace = (updated) => setItems((list) => list.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)));

  if (items === null) return <p className="center">{error || t('reg.loading')}</p>;

  return (
    <main className="registry">
      <section className="registry-head">
        <div>
          <h1>{t('reg.title')}</h1>
          <p className="hint">{t('reg.intro')}</p>
        </div>
        {!adding && <button className="primary-inline" onClick={() => setAdding(true)}>{t('reg.add')}</button>}
      </section>

      {adding && (
        <RegisterForm
          devices={devices}
          onCancel={() => setAdding(false)}
          onTaken={(identifier) => {
            setDisputeFor(identifier);
            document.getElementById('disputes')?.scrollIntoView({ behavior: 'smooth' });
          }}
          onDone={(item) => {
            setItems((list) => [item, ...list]);
            setAdding(false);
          }}
        />
      )}

      {items.length === 0 && !adding && <p className="card hint">{t('reg.empty')}</p>}
      <div className="item-grid">
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            devices={devices}
            onChange={replace}
            onRemoved={(id) => setItems((list) => list.filter((i) => i.id !== id))}
          />
        ))}
      </div>

      <div className="item-grid">
        <ClaimForm onClaimed={(item) => setItems((list) => [{ ...item, report: null }, ...list])} />
        <Disputes prefill={disputeFor} />
      </div>
    </main>
  );
}
