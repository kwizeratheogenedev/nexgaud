import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import CheckPage from './pages/CheckPage.jsx';
import { I18nProvider } from './i18n.jsx';
import './App.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      {/* The public check page needs no sign-in. */}
      {window.location.pathname.replace(/\/+$/, '') === '/check' ? <CheckPage /> : <App />}
    </I18nProvider>
  </StrictMode>,
);
