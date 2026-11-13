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
  app.use(
    pinoHttp({
      logger,
      // One short line per request: no headers (they can carry tokens) and no stack for expected 4xx/503s.
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
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
  api.use('/device', deviceApiRouter); // the phone itself
  api.use('/alerts', alertsRouter); // owners
  api.use('/admin', adminRouter); // the NexGuard team
  app.use('/api/v1', api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
