import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from './i18n.jsx';
import './App.css';

// Each entry loads only its own code: the finder page opened from a QR scan on a phone stays small.
const App = lazy(() => import('./App.jsx'));
const CheckPage = lazy(() => import('./pages/CheckPage.jsx'));
const FinderPage = lazy(() => import('./pages/FinderPage.jsx'));

// Public pages need no sign-in: the phone check (/check) and the finder page of a QR tag (/t/<code>).
function page() {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/check') return <CheckPage />;
  const tag = path.match(/^\/t\/([A-Za-z0-9-]{6,16})$/);
  if (tag) return <FinderPage code={tag[1]} />;
  return <App />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <Suspense fallback={null}>{page()}</Suspense>
    </I18nProvider>
  </StrictMode>,
);
