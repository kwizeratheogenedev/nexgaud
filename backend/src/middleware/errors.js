import { logger } from '../logger.js';

export function notFound(req, res) {
  res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.path}` });
}

// Express spots an error handler by its four arguments, so _next must stay.
export function errorHandler(err, req, res, _next) {
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) logger.error({ err }, 'Unhandled error');
  if (status >= 500) {
    return res.status(status).json({ error: 'internal_error', message: 'Something went wrong' });
  }
  res.status(status).json({
    error: typeof err.code === 'string' ? err.code : 'bad_request',
    message: err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}
