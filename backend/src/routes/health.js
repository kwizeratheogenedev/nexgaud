import { readFileSync } from 'node:fs';
import { Router } from 'express';
import { dbState } from '../db.js';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const router = Router();
const startedAt = new Date();

// Used by the staging deploy, uptime checks and the dashboard's status badge.
router.get('/', (_req, res) => {
  const db = dbState();
  res.status(db === 'connected' ? 200 : 503).json({
    status: db === 'connected' ? 'ok' : 'degraded',
    db,
    version,
    startedAt: startedAt.toISOString(),
    uptimeSec: Math.round(process.uptime()),
  });
});

export default router;
