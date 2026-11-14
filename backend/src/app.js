import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import devicesRouter from './routes/devices.js';
import deviceApiRouter from './routes/deviceApi.js';
import alertsRouter from './routes/alerts.js';
import adminRouter from './routes/admin.js';
import registryRouter from './routes/registry.js';
import checkRouter from './routes/check.js';
import gatewayRouter from './routes/gateway.js';
import partnerRouter from './routes/partner.js';
import adminRegistryRouter from './routes/adminRegistry.js';
import adminTagsRouter from './routes/adminTags.js';
import devicePairRouter from './routes/devicePair.js';
import tagsRouter from './routes/tags.js';
import orgsRouter from './routes/orgs.js';
import billingRouter from './routes/billing.js';
import familyRouter from './routes/family.js';
import adminBillingRouter from './routes/adminBilling.js';
import { metricsMiddleware, metricsRoute } from './lib/metrics.js';
import { tooMany } from './lib/errors.js';
import { notFound, errorHandler } from './middleware/errors.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(metricsMiddleware);
  app.use(
    pinoHttp({
      logger,
      // One short line per request: no headers (they can carry tokens) and no stack for expected 4xx/503s.
      serializers: {
        // The gateway secret (?key=) and checked IMEIs (?q=) stay out of the logs.
        req: (req) => ({ method: req.method, url: req.url.replace(/([?&](?:key|q)=)[^&]*/g, '$1[redacted]').replace(/(\/threads\/)[\w-]{20,}/, '$1[redacted]') }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'warn' : 'info'),
      customErrorMessage: (_req, res) => `request failed with ${res.statusCode}`,
    }),
  );

  // All routes live under /api/v1 (see the API design in the plan).
  const api = express.Router();
  api.use('/health', healthRouter);
  // A broad per-IP ceiling; sign-in routes add tighter limits of their own.
  api.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: () => config.isTest,
      handler: (_req, _res, next) => next(tooMany()),
    }),
  );
  api.use('/auth', authRouter);
  api.use('/devices', devicesRouter); // owners
  api.use('/device/pair', devicePairRouter); // laptop agents swap a pairing code for a device token
  api.use('/device', deviceApiRouter); // the phone or laptop itself
  api.use('/alerts', alertsRouter); // owners
  api.use('/admin', adminRouter); // the NexGuard team
  api.use('/admin', adminRegistryRouter);
  api.use('/admin', adminTagsRouter); // the NexGuard team: tag batches, organisations, Phase 4 statistics // the NexGuard team: registry reviews, partners, audit log
  api.use('/registry', registryRouter); // owners: registered IMEIs, reports, disputes
  api.use('/check', checkRouter); // anyone: is this phone reported stolen?
  api.use('/gateway', gatewayRouter); // USSD and SMS callbacks from Africa's Talking
  api.use('/partner', partnerRouter);
  api.use('/tags', tagsRouter); // QR tags: /tags/public for finders, the rest for owners
  api.use('/orgs', orgsRouter); // schools and companies
  api.use('/billing', billingRouter); // plans, invoices, mobile money payments
  api.use('/family', familyRouter); // family sharing (Family plan)
  api.use('/admin', adminBillingRouter); // the NexGuard team: revenue and the Phase 5 gate // partner shops and police: portal and API
  app.use('/api/v1', api);
  app.get('/metrics', metricsRoute); // Prometheus, outside /api/v1 like most exporters

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
