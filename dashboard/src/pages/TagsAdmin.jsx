import { useCallback, useEffect, useState } from 'react';
import { adminOrgs, createTagBatch, listTagBatches, phase4Stats, setOrgStatus, tagBatchSheet } from '../api.js';
import { timeAgo } from '../format.js';
import StickerSheet from '../components/StickerSheet.jsx';

// For the NexGuard team (English only): the Phase 4 gate, printed tag batches and organisations.
const ago = (v) => timeAgo(v, 'en', (k) => ({ never: 'never', justNow: 'just now' })[k] ?? k);
const errorText = (err) => (err.details ? Object.values(err.details).flat()[0] : err.message);
const LABELS = { print: 'Print', close: 'Close', hint: 'A4, 24 stickers per page. A claim code activates its tag: give it to the buyer with the sticker, and keep unsold sheets away from customers.', scan: 'Found this? Scan me', claim: 'Claim code' };

function Stat({ label, value, note, tone }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

export default function TagsAdmin() {
  const [stats, setStats] = useState(null);
  const [batches, setBatches] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [form, setForm] = useState({ name: '', count: 24 });
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    phase4Stats().then(setStats).catch((err) => setError(err.message));
    listTagBatches().then(setBatches).catch(() => {});
    adminOrgs().then(setOrgs).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function create(e) {
    e.preventDefault();
    try {
      await createTagBatch({ name: form.name.trim(), count: Number(form.count) });
      setForm({ name: '', count: 24 });
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function print(batch) {
    try {
      const res = await tagBatchSheet(batch.id);
      // Claimed tags are already in use: print only the ones still for sale.
      setSheet({ title: res.batch.name, tags: res.tags.filter((t) => t.status === 'unclaimed') });
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!stats) return <p className="center">{error || 'Loading…'}</p>;
  const gate = stats.gate;

  return (
    <main className="pilot">
      <section className={`card gate ${gate.passed ? 'passed' : ''}`}>
        <h2>Phase 4 gate: {gate.passed ? 'passed' : 'not yet'}</h2>
        <p className="hint">{gate.tagsTarget} tags in use, and the laptop agent running (seen in the last 7 days) on Windows, macOS and Linux.</p>
        <div className="stats">
          <Stat label="Tags in use" value={`${gate.tagsInUse} / ${gate.tagsTarget}`} tone={gate.tagsInUse >= gate.tagsTarget ? 'good' : ''} />
          <Stat label="Systems with a running agent" value={`${gate.platformsRunning} / ${gate.platformsTarget}`} tone={gate.platformsRunning === gate.platformsTarget ? 'good' : ''} />
          <Stat label="Tag scans, 7 days" value={stats.tags.scans7d} note={`${stats.tags.threads7d} finder conversations`} />
          <Stat label="Unclaimed printed tags" value={stats.tags.statuses.unclaimed ?? 0} note={`${stats.tags.batches} batches`} />
        </div>
      </section>

      <div className="pilot-grid">
        <section className="card">
          <h2>Laptops</h2>
          <table className="table">
            <thead>
              <tr><th>System</th><th className="num">Laptops</th><th className="num">Seen 7 days</th><th className="num">In organisations</th></tr>
            </thead>
            <tbody>
              {Object.entries(stats.laptops).map(([os, row]) => (
                <tr key={os} className={row.seen7d === 0 ? 'row-warn' : ''}>
                  <td>{{ windows: 'Windows', macos: 'macOS', linux: 'Linux' }[os]}</td>
                  <td className="num">{row.devices}</td>
                  <td className="num">{row.seen7d}</td>
                  <td className="num">{row.inOrgs}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2 className="spaced">Organisations</h2>
          {orgs.length === 0 ? (
            <p className="hint">None yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Name</th><th className="num">Managers</th><th className="num">Laptops</th><th className="num">Tags</th><th /></tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id} className={o.status !== 'active' ? 'row-bad' : ''}>
                      <td>{o.name}<small className="block">{o.type}{o.district ? ` · ${o.district}` : ''}</small></td>
                      <td className="num">{o.members}</td>
                      <td className="num">{o.devices}</td>
                      <td className="num">{o.tags}</td>
                      <td>
                        <button
                          className="link"
                          onClick={() =>
                            window.confirm(`${o.status === 'active' ? 'Suspend' : 'Reactivate'} ${o.name}?`) &&
                            setOrgStatus(o.id, o.status === 'active' ? 'suspended' : 'active').then(load).catch((err) => setError(errorText(err)))
                          }
                        >
                          {o.status === 'active' ? 'Suspend' : 'Reactivate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Printed tag batches</h2>
          <p className="hint">For shops, schools and events. Each sticker has a claim code that activates it; whoever holds the claim code can take the tag.</p>
          <form className="message-form" onSubmit={create}>
            <input aria-label="Batch name" placeholder="Batch name, e.g. Kigali Phones, November" required minLength={2} maxLength={80} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <input aria-label="How many" type="number" min={1} max={500} className="narrow" value={form.count} onChange={(e) => setForm((f) => ({ ...f, count: e.target.value }))} />
            <button type="submit" disabled={!form.name.trim()}>Make</button>
          </form>
          {batches.length === 0 ? (
            <p className="hint">No batches yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Batch</th><th className="num">Claimed</th><th>Made</th><th /></tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}{b.partner ? <small className="block">{b.partner}</small> : null}</td>
                    <td className="num">{b.claimed} / {b.count}</td>
                    <td>{ago(b.createdAt)}</td>
                    <td><button className="link" onClick={() => print(b)} disabled={b.claimed === b.count}>Print</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      </div>
      {sheet && <StickerSheet title={sheet.title} tags={sheet.tags} labels={LABELS} onClose={() => setSheet(null)} />}
    </main>
  );
}
