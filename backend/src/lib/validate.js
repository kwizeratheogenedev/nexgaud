import { z } from 'zod';
import { HttpError } from './errors.js';

/**
 * Validates req.body / req.query / req.params with a zod schema.
 * Express 5 makes req.query read-only, so parsed values go to req.valid[part].
 */
export function validate(schema, part = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[part] ?? {});
    if (!result.success) {
      const err = new HttpError(400, 'validation_failed', 'Some fields are missing or invalid');
      err.details = z.flattenError(result.error).fieldErrors;
      return next(err);
    }
    req.valid = { ...(req.valid ?? {}), [part]: result.data };
    next();
  };
}

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
