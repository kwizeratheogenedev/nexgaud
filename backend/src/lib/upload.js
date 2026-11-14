import express from 'express';
import { Upload, UPLOAD_MAX_BYTES, UPLOAD_TYPES, sniffType } from '../models/Upload.js';
import { badRequest, HttpError } from './errors.js';

/**
 * File uploads are sent as the raw request body (Content-Type: image/jpeg, image/png, image/webp
 * or application/pdf), so no multipart parser is needed. The real type is read from the bytes.
 */
export const rawUpload = [
  express.raw({ type: () => true, limit: UPLOAD_MAX_BYTES }),
  (err, _req, _res, next) => {
    if (err?.type === 'entity.too.large') return next(new HttpError(413, 'file_too_large', 'Files can be at most 3 MB'));
    next(err);
  },
];

export async function saveUpload(req, ownerId) {
  const data = req.body;
  if (!Buffer.isBuffer(data) || data.length === 0) throw badRequest('file_missing', 'Attach a photo or PDF');
  const mime = sniffType(data);
  if (!mime || !UPLOAD_TYPES.includes(mime)) throw badRequest('file_type', 'Use a JPEG, PNG or WebP photo, or a PDF');
  return Upload.create({ ownerId, mime, size: data.length, data });
}

/** Sends a stored file so the browser shows it but can never run it as a page. */
export function sendUpload(res, upload) {
  res.set({
    'Content-Type': upload.mime,
    'Content-Length': String(upload.size),
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(upload.data);
}
