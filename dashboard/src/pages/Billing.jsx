import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  addFamilyMember,
  billingMe,
  checkout,
  createFamily,
  deleteFamily,
  getFamily,
  getInvoice,
  getPayment,
  listInvoices,
  payInvoice,
  removeFamilyMember,
  voidInvoice,
} from '../api.js';
import { dateTime } from '../format.js';
import { useI18n } from '../i18n.jsx';

const errorText = (err) => (err.details ? Object.values(err.details).flat()[0] : err.message);
const money = (n) => Number(n).toLocaleString('en').replace(/,/g, ' ');
const day = (v, lang) => (v ? new Date(v).toLocaleDateString(lang, { dateStyle: 'medium' }) : '—');

/** Pays an invoice: choose MTN or Airtel, send the request, wait while the person approves on their phone. */
function PayDialog({ invoice, providers, defaultPhone, onClose, onPaid }) {
  const { t } = useI18n();
  const [provider, setProvider] = useState(providers[0]);
  const [phone, setPhone] = useState(defaultPhone ?? '');
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (payment?.status !== 'pending') return undefined;
    const id = setInterval(async () => {
      try {
        const res = await getPayment(payment.id);
        setPayment(res.payment);
        if (res.payment.status === 'successful') onPaid(res.invoice);
      } catch {
        // keep waiting
      }
    }, 4000);
    return () => clearInterval(id);
  }, [payment, onPaid]);

  async function send(e) {
    e.preventDefault();
    setError('');
    try {
      setPayment(await payInvoice(invoice.id, provider, phone.trim()));
    } catch (err) {
      setError(errorText(err));
    }
  }

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-label={t('bill.payTitle', { number: invoice.number })}>
      <div className="card modal">
        <h2>{t('bill.payTitle', { number: invoice.number })}</h2>
        <p className="big-total">{money(invoice.total)} RWF</p>
        {!payment || ['failed', 'expired'].includes(payment.status) ? (
          <form onSubmit={send}>
            {providers.length === 0 && <p className="error">{t('bill.noProviders')}</p>}
            <fieldset className="choice">
              <legend>{t('bill.payWith')}</legend>
              {providers.map((p) => (
                <label key={p} className="inline">
                  <input type="radio" name="provider" value={p} checked={provider === p} onChange={() => setProvider(p)} /> {t(`bill.provider.${p}`)}
                </label>
              ))}
            </fieldset>
            <label htmlFor="pay-phone">{t('bill.phone')}</label>
            <input id="pay-phone" type="tel" inputMode="tel" required maxLength={20} placeholder={provider === 'airtel_money' ? '0731 234 567' : '0788 123 456'} value={phone} onChange={(e) => setPhone(e.target.value)} />
            {payment?.status === 'failed' && <p className="error">{t('bill.failed', { reason: payment.failureReason ?? '' })}</p>}
            {payment?.status === 'expired' && <p className="error">{t('bill.expired')}</p>}
            {error && <p className="error" role="alert">{error}</p>}
            <div className="actions spaced-top">
              <button type="submit" className="primary-inline" disabled={!providers.length || !phone.trim()}>
                {payment ? t('bill.tryAgain') : t('bill.send')}
              </button>
              <button type="button" className="link" onClick={onClose}>{t('bill.close')}</button>
            </div>
          </form>
        ) : payment.status === 'pending' ? (
          <div role="status">
            <p>{t('bill.approve', { total: money(invoice.total) })}</p>
            <p className="hint waiting">{t('bill.waiting')}</p>
            <button className="link" onClick={onClose}>{t('bill.close')}</button>
          </div>
        ) : (
          <div role="status">
            <p className="ok-text">{t('bill.paid')}</p>
            <button className="primary-inline" onClick={onClose}>{t('bill.close')}</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** A printable invoice (or receipt, once paid). */
function InvoiceView({ invoice, payments, onClose }) {
  const { lang, t } = useI18n();
  useEffect(() => {
    document.body.classList.add('printing-invoice');
    return () => document.body.classList.remove('printing-invoice');
  }, []);
  const paid = payments.find((p) => p.status === 'successful');
  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-label={invoice.number}>
      <div className="card modal invoice-sheet">
        <div className="actions no-print">
          <button className="primary-inline" onClick={() => window.print()}>{t('bill.print')}</button>
          <button onClick={onClose}>{t('bill.close')}</button>
        </div>
        <header className="invoice-head">
          <div>
            <strong className="invoice-brand">NexGuard</strong>
            <div className="hint">Nexera Digital Tech · Kigali, Rwanda</div>
          </div>
          <div className="invoice-meta">
            <h2>{invoice.status === 'paid' ? t('bill.receipt') : t('bill.invoice')}</h2>
            <div className="mono">{invoice.number}</div>
            <div>{t('bill.date')}: {day(invoice.createdAt, lang)}</div>
          </div>
        </header>
        {invoice.billTo && (
          <p>
            {t('bill.billedTo')}: <strong>{invoice.billTo.name}</strong>
            {invoice.billTo.tin ? ` · TIN ${invoice.billTo.tin}` : ''}
          </p>
        )}
        <table className="table">
          <thead>
            <tr><th>{t('bill.item')}</th><th className="num">{t('bill.qty')}</th><th className="num">{t('bill.unit')}</th><th className="num">{t('bill.amount')}</th></tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i}><td>{l.description}</td><td className="num">{l.quantity}</td><td className="num">{money(l.unitPrice)}</td><td className="num">{money(l.amount)}</td></tr>
            ))}
            <tr className="total-row"><td colSpan={3}>{t('bill.total')}</td><td className="num">{money(invoice.total)} {invoice.currency}</td></tr>
          </tbody>
        </table>
        <p>
          <span className={`badge badge-invoice-${invoice.status}`}>{t(`bill.status.${invoice.status}`)}</span>
          {invoice.paidAt && ` ${t('bill.paidOn', { date: dateTime(invoice.paidAt, lang) })}`}
          {paid && ` · ${t(`bill.provider.${paid.provider}`)} ${paid.payerPhone}`}
        </p>
      </div>
    </div>,
    document.body,
  );
}

function FamilyPlan({ me, onBuy }) {
  const { lang, t } = useI18n();
  const [months, setMonths] = useState(1);
  const f = me.family;
  const total = months * me.prices.family;
  return (
    <section className="card plan-card">
      <header className="item-head">
        <h2>{t('bill.family')}</h2>
        <span className={`badge ${f.active ? 'badge-done' : ''}`}>{f.active ? (f.inGrace ? t('bill.grace', { date: day(f.paidUntil, lang) }) : t('bill.activeUntil', { date: day(f.paidUntil, lang) })) : t('bill.notActive')}</span>
      </header>
      <p className="hint">{t('bill.familyWhat')}</p>
      <p><strong>{t('bill.perMonth', { price: money(me.prices.family) })}</strong></p>
      <div className="actions">
        <select aria-label={t('bill.months')} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
          {me.allowedMonths.map((m) => <option key={m} value={m}>{t('bill.monthsValue', { count: m })}</option>)}
        </select>
        <button className="primary-inline" onClick={() => onBuy({ plan: 'family', months })}>
          {f.active ? t('bill.renew', { total: money(total) }) : t('bill.buy', { total: money(total) })}
        </button>
      </div>
    </section>
  );
}

function OrgSeatsPlan({ org, me, onBuy }) {
  const { lang, t } = useI18n();
  const s = org.seats;
  const [seats, setSeats] = useState(Math.max(1, s.seatsBought || 1));
  const [months, setMonths] = useState(1);
  const [extra, setExtra] = useState(1);
  const [billTo, setBillTo] = useState(org.name);
  const [tin, setTin] = useState('');
  const bill = billTo.trim() ? { billTo: { name: billTo.trim(), ...(tin.trim() ? { tin: tin.trim() } : {}) } } : {};
  const active = s.active && s.paidUntil && new Date(s.paidUntil) > new Date();
  return (
    <section className="card plan-card">
      <header className="item-head">
        <h2>{t('bill.orgSeats', { org: org.name })}</h2>
        <span className={`badge ${s.active ? 'badge-done' : ''}`}>{s.active ? t('bill.activeUntil', { date: day(s.paidUntil, lang) }) : t('bill.free')}</span>
      </header>
      <p className="hint">{t('bill.orgWhat', { free: s.free, price: money(me.prices.laptopSeat) })}</p>
      <p><strong>{t('bill.laptopsUsed', { count: org.laptops, limit: s.limit })}</strong></p>
      <div className="form-grid">
        <div>
          <label htmlFor={`seats-${org.id}`}>{t('bill.seats')}</label>
          <input id={`seats-${org.id}`} type="number" min={1} max={500} value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
        </div>
        <div>
          <label htmlFor={`months-${org.id}`}>{t('bill.months')}</label>
          <select id={`months-${org.id}`} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {me.allowedMonths.map((m) => <option key={m} value={m}>{t('bill.monthsValue', { count: m })}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`billto-${org.id}`}>{t('bill.billTo')}</label>
          <input id={`billto-${org.id}`} maxLength={100} value={billTo} onChange={(e) => setBillTo(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`tin-${org.id}`}>{t('bill.tin')}</label>
          <input id={`tin-${org.id}`} inputMode="numeric" maxLength={9} value={tin} onChange={(e) => setTin(e.target.value.replace(/\D/g, ''))} />
        </div>
      </div>
      <button className="primary-inline spaced-top" disabled={seats < 1} onClick={() => onBuy({ plan: 'org_seats', orgId: org.id, seats, months, ...bill })}>
        {(active ? t('bill.renew', { total: money(seats * months * me.prices.laptopSeat) }) : t('bill.buy', { total: money(seats * months * me.prices.laptopSeat) }))}
      </button>
      {active && (
        <div className="message-form spaced-top">
          <input type="number" min={1} max={500} aria-label={t('bill.seats')} className="narrow" value={extra} onChange={(e) => setExtra(Number(e.target.value))} />
          <button disabled={extra < 1} onClick={() => onBuy({ plan: 'org_seats', orgId: org.id, seats: extra, addSeats: true, ...bill })}>
            {t('bill.addSeats', { date: day(s.paidUntil, lang) })}
          </button>
        </div>
      )}
    </section>
  );
}

function FamilySharing({ planActive, userId }) {
  const { t } = useI18n();
  const [family, setFamily] = useState(undefined);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const act = async (fn) => {
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    }
  };

  useEffect(() => {
    getFamily().then(setFamily).catch(() => setFamily(null));
  }, [planActive]);

  if (family === undefined) return null;
  return (
    <section className="card">
      <h2>{t('fam.title')}</h2>
      <p className="hint">{t('fam.intro')}</p>
      {!family ? (
        <form className="message-form" onSubmit={(e) => { e.preventDefault(); act(async () => setFamily(await createFamily(name.trim() || undefined))); }}>
          <input aria-label={t('fam.name')} placeholder={t('fam.name')} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit">{t('fam.create')}</button>
        </form>
      ) : (
        <>
          {!family.planActive && <p className="warnings-inline">{family.isOwner ? t('fam.needPlan') : t('fam.planOff')}</p>}
          <h3>{family.name ?? t('fam.people')}</h3>
          <ul className="commands">
            {family.people.map((p) => (
              <li key={p.id}>
                <span>{p.name ?? p.phone}<small className="block">{p.role === 'owner' ? t('fam.owner') : t('fam.member')} · {t('fam.shared', { count: p.sharedDevices })}</small></span>
                {family.isOwner && p.role === 'member' && (
                  <button className="link danger-text" onClick={() => window.confirm(t('fam.removeConfirm', { name: p.name ?? p.phone })) && act(async () => setFamily(await removeFamilyMember(p.id)))}>
                    {t('fam.remove')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {family.isOwner && family.people.length <= family.maxMembers && (
            <form className="message-form" onSubmit={(e) => { e.preventDefault(); act(async () => { setFamily(await addFamilyMember(phone.trim())); setPhone(''); }); }}>
              <input type="tel" aria-label={t('fam.add')} placeholder={t('fam.add')} maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
              <button type="submit" disabled={!phone.trim() || !family.planActive}>{t('fam.addButton')}</button>
            </form>
          )}
          <p className="hint">{t('fam.howToShare')}</p>
          {family.isOwner ? (
            <button className="link danger-text" onClick={() => window.confirm(t('fam.deleteConfirm')) && act(async () => { await deleteFamily(); setFamily(null); })}>{t('fam.delete')}</button>
          ) : (
            <button className="link danger-text" onClick={() => act(async () => { await removeFamilyMember(userId); setFamily(null); })}>{t('fam.leave')}</button>
          )}
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

export default function Billing({ user }) {
  const { lang, t } = useI18n();
  const [me, setMe] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [paying, setPaying] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    billingMe().then(setMe).catch((err) => setError(err.message));
    listInvoices().then(setInvoices).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function buy(body) {
    setError('');
    try {
      const invoice = await checkout(body);
      setInvoices((list) => [invoice, ...list]);
      setPaying(invoice);
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!me) return <p className="center">{error || t('bill.loading')}</p>;

  return (
    <main className="registry">
      <section className="registry-head">
        <div>
          <h1>{t('bill.title')}</h1>
          <p className="hint">{t('bill.intro')}</p>
        </div>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="item-grid">
        <FamilyPlan me={me} onBuy={buy} />
        <FamilySharing planActive={me.family.active} userId={user.id} />
        {me.orgs.map((org) => <OrgSeatsPlan key={org.id} org={org} me={me} onBuy={buy} />)}
      </div>

      <section className="card">
        <h2>{t('bill.invoices')}</h2>
        {invoices.length === 0 ? (
          <p className="hint">{t('bill.noInvoices')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="mono">{inv.number}</td>
                    <td>{inv.lines[0]?.description}</td>
                    <td className="num">{money(inv.total)} RWF</td>
                    <td><span className={`badge badge-invoice-${inv.status}`}>{t(`bill.status.${inv.status}`)}</span></td>
                    <td>{day(inv.createdAt, lang)}</td>
                    <td>
                      <span className="actions">
                        <button className="link" onClick={async () => setViewing(await getInvoice(inv.id))}>{t('bill.view')}</button>
                        {inv.status === 'open' && <button className="link" onClick={() => setPaying(inv)}>{t('bill.payNow')}</button>}
                        {inv.status === 'open' && (
                          <button className="link danger-text" onClick={async () => { try { const v = await voidInvoice(inv.id); setInvoices((l) => l.map((x) => (x.id === v.id ? v : x))); } catch (err) { setError(errorText(err)); } }}>
                            {t('bill.cancelInvoice')}
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {paying && (
        <PayDialog
          invoice={paying}
          providers={me.providers}
          defaultPhone={user.phone?.replace(/^\+250/, '0')}
          onClose={() => {
            setPaying(null);
            load();
          }}
          onPaid={(inv) => setInvoices((l) => l.map((x) => (x.id === inv.id ? inv : x)))}
        />
      )}
      {viewing && <InvoiceView invoice={viewing.invoice} payments={viewing.payments} onClose={() => setViewing(null)} />}
    </main>
  );
}
