import { useCallback, useEffect, useState } from 'react';
import { addOrgMember, createOrg, listOrgs, removeOrgMember, updateDevice } from '../api.js';
import { timeAgo } from '../format.js';
import { useI18n } from '../i18n.jsx';
import AddLaptop from '../components/AddLaptop.jsx';

const TYPES = ['school', 'company', 'ngo', 'other'];
const errorText = (err) => (err.details ? Object.values(err.details).flat()[0] : err.message);

function NewOrg({ onCreated }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: '', type: 'school', district: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      onCreated(await createOrg({ name: form.name.trim(), type: form.type, ...(form.district.trim() ? { district: form.district.trim() } : {}) }));
      setForm({ name: '', type: 'school', district: '' });
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{t('org.create')}</h2>
      <div className="form-grid">
        <div>
          <label htmlFor="org-name">{t('org.name')}</label>
          <input id="org-name" required minLength={2} maxLength={80} value={form.name} onChange={set('name')} />
        </div>
        <div>
          <label htmlFor="org-type">{t('org.type')}</label>
          <select id="org-type" value={form.type} onChange={set('type')}>
            {TYPES.map((x) => <option key={x} value={x}>{t(`org.type.${x}`)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="org-district">{t('org.district')}</label>
          <input id="org-district" maxLength={40} value={form.district} onChange={set('district')} />
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="primary">{t('org.create')}</button>
    </form>
  );
}

function AssignedTo({ device, onSaved }) {
  const { t } = useI18n();
  const [value, setValue] = useState(device.assignedTo ?? '');
  const changed = value.trim() !== (device.assignedTo ?? '');
  return (
    <form className="message-form" onSubmit={(e) => { e.preventDefault(); updateDevice(device.id, { assignedTo: value.trim() }).then(onSaved).catch(() => {}); }}>
      <input aria-label={t('devices.assignedTo')} placeholder={t('devices.assignedTo')} maxLength={60} value={value} onChange={(e) => setValue(e.target.value)} />
      {changed && <button type="submit">{t('org.save')}</button>}
    </form>
  );
}

function OrgCard({ org, devices, me, onChange, onOpenDevice, onDeviceSaved }) {
  const { lang, t } = useI18n();
  const [phone, setPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const laptops = (devices ?? []).filter((d) => d.orgId === org.id);

  async function act(fn) {
    setError('');
    try {
      onChange(org.id, await fn());
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <article className="card">
      <header className="item-head">
        <div>
          <h2>{org.name}</h2>
          <p className="hint">{t(`org.type.${org.type}`)}{org.district ? ` · ${org.district}` : ''} · {t('org.tagCount', { count: org.tags })}</p>
        </div>
        {org.status !== 'active' && <span className="badge badge-failed">{t('org.suspended')}</span>}
      </header>
      <p className="hint">{t('org.transparency', { org: org.name })}</p>

      <h3>{t('org.laptops')} ({laptops.length})</h3>
      {laptops.length === 0 ? (
        <p className="hint">{t('org.noLaptops')}</p>
      ) : (
        <ul className="commands">
          {laptops.map((d) => (
            <li key={d.id}>
              <button className="link" onClick={() => onOpenDevice(d.id)}>{d.name}</button>
              <span className="hint">{d.platform}</span>
              <small>{t('org.lastSeen')} {timeAgo(d.lastSeenAt, lang, t)}{d.hostname ? ` · ${d.hostname}` : ''}</small>
              <div className="full-row"><AssignedTo device={d} onSaved={onDeviceSaved} /></div>
            </li>
          ))}
        </ul>
      )}
      {org.status === 'active' &&
        (adding ? (
          <AddLaptop orgId={org.id} onDone={() => setAdding(false)} />
        ) : (
          <button className="spaced-top" onClick={() => setAdding(true)}>{t('laptop.add')}</button>
        ))}

      <h3>{t('org.managers')}</h3>
      <ul className="commands">
        {org.members.map((m) => (
          <li key={m.id}>
            <span>{m.name ?? m.phone}{m.name ? <small className="block">{m.phone}</small> : null}</span>
            {org.members.length > 1 && (
              <button
                className="link danger-text"
                onClick={() =>
                  window.confirm(t('org.removeConfirm', { name: m.name ?? m.phone })) && act(() => removeOrgMember(org.id, m.id))
                }
              >
                {m.id === me ? t('org.leave') : t('org.remove')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {org.status === 'active' && (
        <form className="message-form" onSubmit={(e) => { e.preventDefault(); act(async () => { const o = await addOrgMember(org.id, phone.trim()); setPhone(''); return o; }); }}>
          <input type="tel" aria-label={t('org.addManager')} placeholder={t('org.addManager')} maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button type="submit" disabled={!phone.trim()}>{t('org.add')}</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}

export default function OrgPage({ user, devices, setDevices, onOpenDevice }) {
  const { t } = useI18n();
  const [orgs, setOrgs] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => listOrgs().then(setOrgs).catch((err) => setError(err.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  if (orgs === null) return <p className="center">{error || t('org.loading')}</p>;

  return (
    <main className="registry">
      <section className="registry-head">
        <div>
          <h1>{t('org.title')}</h1>
          <p className="hint">{t('org.intro')}</p>
        </div>
      </section>
      <div className="item-grid">
        {orgs.map((org) => (
          <OrgCard
            key={org.id}
            org={org}
            me={user.id}
            devices={devices}
            onOpenDevice={onOpenDevice}
            onDeviceSaved={(d) => setDevices((list) => (list ?? []).map((x) => (x.id === d.id ? d : x)))}
            // Leaving an organisation returns null: drop it from the list.
            onChange={(id, updated) => setOrgs((list) => (updated ? list.map((o) => (o.id === id ? updated : o)) : list.filter((o) => o.id !== id)))}
          />
        ))}
        <NewOrg onCreated={(org) => setOrgs((list) => [...list, org])} />
      </div>
    </main>
  );
}
