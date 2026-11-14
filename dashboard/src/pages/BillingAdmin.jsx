import { useEffect, useState } from 'react';
import { adminBillingStats } from '../api.js';
import { timeAgo } from '../format.js';

// For the NexGuard team (English only): revenue, plans and the Phase 5 gate.
const money = (n) => `${Number(n ?? 0).toLocaleString('en').replace(/,/g, ' ')} RWF`;
const ago = (v) => timeAgo(v, 'en', (k) => ({ never: 'never', justNow: 'just now' })[k] ?? k);
const PROVIDERS = { mtn_momo: 'MTN MoMo', airtel_money: 'Airtel Money', fake: 'Test (fake)' };

function Stat({ label, value, note, tone }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

export default function BillingAdmin() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    adminBillingStats().then(setS).catch((err) => setError(err.message));
  }, []);

  if (!s) return <p className="center">{error || 'Loading…'}</p>;
  const g = s.gate;
  return (
    <main className="pilot">
      <section className={`card gate ${g.passed ? 'passed' : ''}`}>
        <h2>Phase 5 gate: {g.passed ? 'passed' : 'not yet'}</h2>
        <p className="hint">
          Paying customers cover server costs: real mobile money received in the last 30 days (RWF, not test payments) against the monthly server cost.
          {!g.costSet && ' Set SERVER_COST_MONTHLY_RWF on the server to measure it.'}
        </p>
        <div className="stats">
          <Stat label="Received, 30 days" value={money(g.revenue30d)} tone={g.passed ? 'good' : ''} />
          <Stat label="Server cost per month" value={g.costSet ? money(g.serverCost) : 'not set'} />
          <Stat label="Active plans bring in" value={money(s.monthlyEstimate)} note="per month, at today's prices" />
          <Stat label="Unpaid invoices" value={s.openInvoices} />
        </div>
      </section>
      <div className="pilot-grid">
        <section className="card">
          <h2>Plans</h2>
          <table className="table">
            <tbody>
              <tr><td>Family plans active</td><td className="num">{s.active.family}</td></tr>
              <tr><td>Organisations paying for seats</td><td className="num">{s.active.orgs}</td></tr>
              <tr><td>Laptop seats paid</td><td className="num">{s.active.seats}</td></tr>
              <tr><td>Family price</td><td className="num">{money(s.prices.family)} / month</td></tr>
              <tr><td>Laptop seat price</td><td className="num">{money(s.prices.laptopSeat)} / month</td></tr>
              <tr><td>Free laptops per organisation</td><td className="num">{s.prices.orgFreeLaptops}</td></tr>
            </tbody>
          </table>
          <h2 className="spaced">Payments, 30 days</h2>
          <table className="table">
            <tbody>
              {Object.entries(s.payments30d).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>)}
              {Object.entries(s.byProvider).map(([k, v]) => <tr key={k}><td>{PROVIDERS[k] ?? k}</td><td className="num">{money(v.total)} ({v.count})</td></tr>)}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2>Recent payments</h2>
          {s.recentPayments.length === 0 ? (
            <p className="hint">None yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>When</th><th>Invoice</th><th>By</th><th>Via</th><th className="num">Amount</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {s.recentPayments.map((p) => (
                    <tr key={p.id} className={p.status === 'failed' ? 'row-warn' : ''}>
                      <td>{ago(p.createdAt)}</td>
                      <td className="mono">{p.invoice ?? '—'}</td>
                      <td>{p.by ?? '—'}<small className="block">{p.payerPhone}</small></td>
                      <td>{PROVIDERS[p.provider] ?? p.provider}{p.providerTxnId ? <small className="block mono">{p.providerTxnId}</small> : null}</td>
                      <td className="num">{p.amount.toLocaleString('en')} {p.currency}</td>
                      <td>{p.status}{p.failureReason ? <small className="block">{p.failureReason}</small> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
