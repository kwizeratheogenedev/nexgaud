import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { formatCode } from '../format.js';

/**
 * A printable A4 sheet of QR stickers (4 × 6 per page). On screen it is a preview with Print and Close;
 * when printing, only the sheet is printed. Batch sheets also print each claim code.
 */
export default function StickerSheet({ title, tags, labels, onClose }) {
  const [svgs, setSvgs] = useState({});

  useEffect(() => {
    let alive = true;
    Promise.all(
      tags.map((t) => QRCode.toString(t.url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then((svg) => [t.code, svg])),
    ).then((pairs) => alive && setSvgs(Object.fromEntries(pairs)));
    return () => {
      alive = false;
    };
  }, [tags]);

  useEffect(() => {
    document.body.classList.add('printing-stickers');
    const close = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', close);
    return () => {
      document.body.classList.remove('printing-stickers');
      document.removeEventListener('keydown', close);
    };
  }, [onClose]);

  return createPortal(
    <div className="sticker-overlay" role="dialog" aria-label={title}>
      <div className="sticker-toolbar no-print">
        <strong>{title}</strong>
        <span className="hint">{labels.hint}</span>
        <span className="spacer" />
        <button className="primary-inline" onClick={() => window.print()} disabled={Object.keys(svgs).length < tags.length}>
          {labels.print}
        </button>
        <button onClick={onClose}>{labels.close}</button>
      </div>
      <div className="sticker-sheet">
        {tags.map((t) => (
          <div className="sticker" key={t.code}>
            {/* The SVG comes from the qrcode library, built from our own tag URL. */}
            <div className="sticker-qr" dangerouslySetInnerHTML={{ __html: svgs[t.code] ?? '' }} />
            <div className="sticker-text">
              <strong>NexGuard</strong>
              <span>{labels.scan}</span>
              <span className="mono">{formatCode(t.code)}</span>
              {t.name && <span className="sticker-name">{t.name}</span>}
              {t.claimCode && <span className="sticker-claim mono">{labels.claim}: {t.claimCode}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
