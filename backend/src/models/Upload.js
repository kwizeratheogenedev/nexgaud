import mongoose from 'mongoose';

/**
 * A proof photo or PDF (box, receipt), stored in MongoDB so the pilot needs no file server.
 * Files are small (at most 3 MB) and few. Move them to object storage before a large launch.
 */
export const UPLOAD_MAX_BYTES = 3 * 1024 * 1024;
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const uploadSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mime: { type: String, enum: UPLOAD_TYPES, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true },
);

/** Reads the first bytes, so a file cannot pass for an image by its Content-Type alone. */
export function sniffType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

export const Upload = mongoose.model('Upload', uploadSchema);
