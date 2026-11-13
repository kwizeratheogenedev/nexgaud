// In production set VITE_API_URL to the deployed API (for example https://api.example.com).
const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1';

export async function getHealth() {
  const res = await fetch(`${BASE}/health`, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, ...body };
}
