import express, { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { hmac } from '../lib/crypto.js';
import { maskPhone, normalizePhone } from '../lib/phone.js';
import { CheckLog } from '../models/CheckLog.js';
import { checkPageUrl, checkText, runCheck, smsHelpText } from '../services/registry.js';
import { sendSms } from '../services/sms.js';

/**
 * Registry checks for phones without internet, through Africa's Talking:
 * - USSD: they dial the code, pick a language, type the IMEI, and read the answer on screen.
 * - SMS: they text "REBA <IMEI>" (or CHECK / VERIFIER) to the short code and get an SMS back.
 * Africa's Talking does not sign its callbacks, so the callback URLs carry ?key=GATEWAY_SECRET.
 */
const router = Router();
router.use(express.urlencoded({ extended: false, limit: '20kb' }));

const MAX_SMS_CHECKS_PER_DAY = 10;
const digest = (v) => createHash('sha256').update(String(v ?? '')).digest();

router.use((req, res, next) => {
  if (!config.gatewaySecret) return res.status(404).json({ error: 'not_found', message: 'Gateway is not set up' });
  if (!timingSafeEqual(digest(req.query.key), digest(config.gatewaySecret))) {
    return res.status(403).json({ error: 'forbidden', message: 'Not allowed' });
  }
  next();
});

const USSD = {
  menu: 'CON NexGuard\n1. Kinyarwanda\n2. English\n3. Français',
  langs: { 1: 'rw', 2: 'en', 3: 'fr' },
  ask: {
    rw: 'CON Andika IMEI ya telefoni (imibare 15). Kanda *#06# kuri yo uyibone:',
    en: 'CON Enter the phone\'s IMEI (15 digits). Dial *#06# on it to see it:',
    fr: 'CON Entrez l\'IMEI du téléphone (15 chiffres). Composez *#06# dessus pour le voir :',
  },
  badChoice: 'END 1, 2 or 3.',
};

router.post('/ussd', async (req, res) => {
  const text = String(req.body.text ?? '').trim();
  const parts = text ? text.split('*') : [];
  let reply;
  if (parts.length === 0) {
    reply = USSD.menu;
  } else {
    const lang = USSD.langs[parts[0]];
    if (!lang) reply = USSD.badChoice;
    else if (parts.length === 1) reply = USSD.ask[lang];
    else {
      const phone = normalizePhone(String(req.body.phoneNumber ?? ''));
      const view = await runCheck(parts.slice(1).join(''), { source: 'ussd', requester: phone ?? req.body.sessionId });
      reply = `END ${checkText(view, lang)}`;
    }
  }
  res.type('text/plain').send(reply);
});

const KEYWORDS = { check: 'en', reba: 'rw', verifier: 'fr', vérifier: 'fr' };

router.post('/sms', async (req, res) => {
  const from = normalizePhone(String(req.body.from ?? ''));
  const text = String(req.body.text ?? '').trim();
  // Africa's Talking only needs a 200; the answer goes back as a new SMS (sent before replying, it takes a moment).
  const done = () => res.status(200).type('text/plain').send('OK');
  if (!from) return done();

  try {
    // "REBA 356938035643809", "CHECK C02XK1ABJG5H", or just the IMEI (answered in Kinyarwanda).
    const match = text.match(/^(\S+)\s+(.+)$/s);
    const keyword = KEYWORDS[(match?.[1] ?? text).toLowerCase()];
    const lang = keyword ?? 'rw';
    let query = text;
    if (keyword && match) {
      query = match[2];
    } else if (keyword || !/^[\d\s\-/.]{14,}$/.test(text)) {
      // Only a keyword, or something that is not an IMEI: explain how it works.
      await sendSms(from, `${smsHelpText(lang)}${checkPageUrl() ? ` ${checkPageUrl()}` : ''}`);
      return done();
    }

    const recent = await CheckLog.countDocuments({
      source: 'sms',
      requesterHash: hmac(`check:${from}`),
      createdAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) },
    });
    if (recent >= MAX_SMS_CHECKS_PER_DAY) return done();

    const view = await runCheck(query, { source: 'sms', requester: from });
    await sendSms(from, `NexGuard: ${checkText(view, lang)}`);
  } catch (err) {
    logger.warn({ err: err.message, from: maskPhone(from) }, 'SMS check failed');
  }
  done();
});

export default router;
