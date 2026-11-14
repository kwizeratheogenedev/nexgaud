import { createHash, timingSafeEqual } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { config } from '../config.js';
import { dbState } from '../db.js';

/**
 * A small Prometheus exporter (text format 0.0.4), with no extra package.
 * GET /metrics with "Authorization: Bearer <METRICS_TOKEN>". Off in production without a token.
 * Route labels use the route pattern (/devices/:id), never real ids, to keep the series few.
 */
const BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const requests = new Map(); // "method|route|status" → count
const durations = new Map(); // "method|route" → { buckets: number[], sum, count }
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

/**
 * The route pattern, e.g. /api/v1/devices/:id. Express resets req.baseUrl when an error leaves a router,
 * so the prefix is rebuilt from the URL: drop as many segments as the route pattern has.
 */
export function routeOf(req) {
  const pattern = req.route?.path;
  if (typeof pattern !== 'string') return 'unmatched';
  const segments = (req.originalUrl ?? req.url).split('?')[0].split('/').filter(Boolean);
  const own = pattern.split('/').filter(Boolean);
  const prefix = segments.slice(0, Math.max(0, segments.length - own.length));
  return `/${[...prefix, ...own].join('/')}`;
}

export function metricsMiddleware(req, res, next) {
  if (req.path === '/metrics') return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = routeOf(req);
    const key = `${req.method}|${route}|${res.statusCode}`;
    requests.set(key, (requests.get(key) ?? 0) + 1);
    const dkey = `${req.method}|${route}`;
    const d = durations.get(dkey) ?? { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
    BUCKETS.forEach((b, i) => {
      if (seconds <= b) d.buckets[i] += 1;
    });
    d.sum += seconds;
    d.count += 1;
    durations.set(dkey, d);
  });
  next();
}

const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// Business numbers change slowly: count them at most once a minute.
let cached = { at: 0, lines: [] };
async function businessGauges() {
  if (Date.now() - cached.at < 60000) return cached.lines;
  const { Device } = await import('../models/Device.js');
  const { Payment } = await import('../models/Billing.js');
  const day = new Date(Date.now() - 86400 * 1000);
  const [seen, pending] = await Promise.all([
    Device.countDocuments({ lastSeenAt: { $gte: day } }),
    Payment.countDocuments({ status: 'pending' }),
  ]);
  cached = {
    at: Date.now(),
    lines: [
      '# HELP nexguard_devices_seen_24h Devices that checked in during the last 24 hours.',
      '# TYPE nexguard_devices_seen_24h gauge',
      `nexguard_devices_seen_24h ${seen}`,
      '# HELP nexguard_payments_pending Mobile money payments waiting for approval.',
      '# TYPE nexguard_payments_pending gauge',
      `nexguard_payments_pending ${pending}`,
    ],
  };
  return cached.lines;
}

export async function renderMetrics() {
  const lines = [
    '# HELP http_requests_total HTTP requests by method, route and status.',
    '# TYPE http_requests_total counter',
  ];
  for (const [key, count] of requests) {
    const [method, route, status] = key.split('|');
    lines.push(`http_requests_total{method="${method}",route="${esc(route)}",status="${status}"} ${count}`);
  }
  lines.push('# HELP http_request_duration_seconds Time to answer, by method and route.', '# TYPE http_request_duration_seconds histogram');
  for (const [key, d] of durations) {
    const [method, route] = key.split('|');
    const labels = `method="${method}",route="${esc(route)}"`;
    BUCKETS.forEach((b, i) => lines.push(`http_request_duration_seconds_bucket{${labels},le="${b}"} ${d.buckets[i]}`));
    lines.push(`http_request_duration_seconds_bucket{${labels},le="+Inf"} ${d.count}`);
    lines.push(`http_request_duration_seconds_sum{${labels}} ${d.sum.toFixed(6)}`);
    lines.push(`http_request_duration_seconds_count{${labels}} ${d.count}`);
  }
  const mem = process.memoryUsage();
  lines.push(
    '# HELP process_resident_memory_bytes Memory used by the API process.',
    '# TYPE process_resident_memory_bytes gauge',
    `process_resident_memory_bytes ${mem.rss}`,
    '# HELP nodejs_eventloop_delay_p99_seconds How long requests may wait for the event loop (99th percentile).',
    '# TYPE nodejs_eventloop_delay_p99_seconds gauge',
    `nodejs_eventloop_delay_p99_seconds ${(loopDelay.percentile(99) / 1e9).toFixed(6)}`,
    '# HELP process_uptime_seconds Seconds since the API started.',
    '# TYPE process_uptime_seconds gauge',
    `process_uptime_seconds ${Math.round(process.uptime())}`,
    '# HELP nexguard_db_up 1 when MongoDB is connected.',
    '# TYPE nexguard_db_up gauge',
    `nexguard_db_up ${dbState() === 'connected' ? 1 : 0}`,
  );
  if (dbState() === 'connected') lines.push(...(await businessGauges().catch(() => [])));
  return `${lines.join('\n')}\n`;
}

const digest = (v) => createHash('sha256').update(String(v ?? '')).digest();

export async function metricsRoute(req, res) {
  if (config.metricsToken) {
    const given = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!timingSafeEqual(digest(given), digest(config.metricsToken))) return res.status(401).end();
  } else if (config.isProd) {
    return res.status(404).end();
  }
  res.type('text/plain; version=0.0.4').send(await renderMetrics());
}
