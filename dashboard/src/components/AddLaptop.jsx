import { useState } from 'react';
import { apiBaseForAgents, makePairingCode } from '../api.js';
import { dateTime } from '../format.js';
import { useI18n } from '../i18n.jsx';

/** Makes a one-time pairing code and shows the steps to install the agent on a laptop. */
export default function AddLaptop({ orgId, onDone }) {
  const { lang, t } = useI18n();
  const [name, setName] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [pairing, setPairing] = useState(null);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      setPairing(
        await makePairingCode({
          ...(orgId ? { orgId } : {}),
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(assignedTo.trim() ? { assignedTo: assignedTo.trim() } : {}),
        }),
      );
    } catch (err) {
      setError(err.details ? Object.values(err.details).flat()[0] : err.message);
    }
  }

  if (pairing) {
    return (
      <div className="add-laptop">
        <p>{t('laptop.code')}: <strong className="mono code-big">{pairing.code}</strong></p>
        <p className="hint">{t('laptop.expires', { time: dateTime(pairing.expiresAt, lang) })}</p>
        <ol className="steps">
          <li>{t('laptop.step1')}</li>
          <li>
            {t('laptop.step2')}
            <code className="mono block-code">node src/cli.js pair {pairing.code} --api {apiBaseForAgents()}</code>
          </li>
          <li>
            {t('laptop.step3')}
            <code className="mono block-code">node src/cli.js install</code>
          </li>
        </ol>
        <p className="hint">{t('laptop.macNote')}</p>
        <button onClick={onDone}>{t('laptop.done')}</button>
      </div>
    );
  }

  return (
    <form className="add-laptop" onSubmit={submit}>
      <p className="hint">{t('laptop.intro')}</p>
      <label htmlFor={`laptop-name-${orgId ?? 'me'}`}>{t('laptop.name')}</label>
      <input id={`laptop-name-${orgId ?? 'me'}`} maxLength={60} placeholder="ThinkPad" value={name} onChange={(e) => setName(e.target.value)} />
      {orgId && (
        <>
          <label htmlFor={`laptop-assigned-${orgId}`}>{t('laptop.assignedTo')}</label>
          <input id={`laptop-assigned-${orgId}`} maxLength={60} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions spaced-top">
        <button type="submit" className="primary-inline">{t('laptop.makeCode')}</button>
        <button type="button" className="link" onClick={onDone}>{t('tags.cancel')}</button>
      </div>
    </form>
  );
}
