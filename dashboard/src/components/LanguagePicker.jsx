import { LANGUAGES, useI18n } from '../i18n.jsx';

export default function LanguagePicker({ onChange }) {
  const { lang, setLang, t } = useI18n();
  return (
    <select
      className="lang"
      value={lang}
      aria-label={t('language')}
      onChange={(e) => {
        setLang(e.target.value);
        onChange?.(e.target.value);
      }}
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>{l.label}</option>
      ))}
    </select>
  );
}
