import { logger } from '../logger.js';

export function notFound(req, res) {
  res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.path}` });
}

// Express spots an error handler by its four arguments, so _next must stay.
export function errorHandler(err, req, res, _next) {
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) logger.error({ err }, 'Unhandled error');
  res.status(status).json({
    error: err.code ?? (status >= 500 ? 'internal_error' : 'bad_request'),
    message: status >= 500 ? 'Something went wrong' : err.message,
  });
}
