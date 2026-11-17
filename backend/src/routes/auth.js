import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { OtpCode } from '../models/OtpCode.js';
import { hmac, safeEqualHex, sixDigitCode } from '../lib/crypto.js';
import { badRequest, tooMany, unauthorized } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { validate } from '../lib/validate.js';
import { sendSms } from '../services/sms.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../services/tokens.js';
import { requireUser } from '../middleware/auth.js';

const router = Router();

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_AFTER_MS = 60 * 1000;
const MAX_SENDS_PER_CODE = 5;
const MAX_ATTEMPTS = 5;
const REFRESH_COOKIE = 'nexguard_rt';

// Per-IP limits on top of the per-phone limits below. Off in tests so tests can run many flows.
const ipLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: (_req, _res, next) => next(tooMany()),
});

const phoneField = z.string().transform((v, ctx) => {
  const phone = normalizePhone(v);
  if (!phone) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number' });
    return z.NEVER;
  }
  return phone;
});

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86400 * 1000,
  });
}

function issueTokens(res, user) {
  const refreshToken = signRefreshToken(user);
  setRefreshCookie(res, refreshToken);
  // Phones store the refresh token themselves; the web dashboard relies on the httpOnly cookie.
  return { user: user.toPublic(), accessToken: signAccessToken(user), refreshToken };
}

router.post('/otp/request', ipLimiter, validate(z.object({ phone: phoneField })), async (req, res) => {
  const { phone } = req.valid.body;
  const now = Date.now();
  const existing = await OtpCode.findOne({ phone });
  const live = existing && existing.expiresAt.getTime() > now;

  if (live) {
    if (now - existing.createdAt.getTime() < RESEND_AFTER_MS) {
      throw tooMany('Wait a minute before asking for a new code');
    }
    if (existing.sentCount >= MAX_SENDS_PER_CODE) {
      throw tooMany('Too many codes sent to this number. Try again in 10 minutes');
    }
  }

  const code = sixDigitCode();
  await OtpCode.findOneAndUpdate(
    { phone },
    {
      $set: {
        codeHash: hmac(`${phone}:${code}`),
        attempts: 0,
        sentCount: live ? existing.sentCount + 1 : 1,
        createdAt: new Date(now),
        // A resend keeps the original window, so the send limit cannot be dodged by resending.
        expiresAt: live ? existing.expiresAt : new Date(now + CODE_TTL_MS),
      },
    },
    { upsert: true },
  );

  await sendSms(phone, `Your NexGuard code is ${code}. It expires in 10 minutes. Never share it.`);
  // Demo mode only (npm run demo, no real SMS): the sign-in page shows the code itself.
  // Never in normal development or production; config.js also refuses demo mode in production.
  const devCode = config.demoShowCodes ? code : undefined;
  res.json({ sent: true, phone, expiresInSec: CODE_TTL_MS / 1000, ...(devCode ? { devCode } : {}) });
});

router.post(
  '/otp/verify',
  ipLimiter,
  validate(
    z.object({
      phone: phoneField,
      code: z.string().regex(/^\d{6}$/, 'The code has 6 digits'),
      name: z.string().trim().min(1).max(80).optional(),
    }),
  ),
  async (req, res) => {
    const { phone, code, name } = req.valid.body;
    const otp = await OtpCode.findOne({ phone });
    if (!otp || otp.expiresAt.getTime() <= Date.now()) {
      throw badRequest('code_expired', 'The code has expired. Ask for a new one');
    }
    if (otp.attempts >= MAX_ATTEMPTS) {
      throw tooMany('Too many wrong codes. Ask for a new one');
    }
    if (!safeEqualHex(otp.codeHash, hmac(`${phone}:${code}`))) {
      otp.attempts += 1;
      await otp.save();
      throw badRequest('code_invalid', `Wrong code. ${MAX_ATTEMPTS - otp.attempts} tries left`);
    }
    await otp.deleteOne();

    let user = await User.findOne({ phone });
    const isNew = !user;
    if (!user) user = new User({ phone, name });
    else if (name && !user.name) user.name = name;
    user.lastLoginAt = new Date();
    await user.save();

    res.status(isNew ? 201 : 200).json({ ...issueTokens(res, user), isNew });
  },
);

router.post('/refresh', async (req, res) => {
  const token = req.body?.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
  const payload = token && verifyToken(token, 'refresh');
  if (!payload) throw unauthorized();
  const user = await User.findById(payload.sub);
  if (!user || user.tokenVersion !== payload.ver) throw unauthorized();
  res.json(issueTokens(res, user));
});

// Signs out this browser. With { everywhere: true } it also invalidates every refresh token.
router.post('/logout', async (req, res) => {
  const token = req.body?.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
  const payload = token && verifyToken(token, 'refresh');
  if (payload && req.body?.everywhere === true) {
    await User.updateOne({ _id: payload.sub, tokenVersion: payload.ver }, { $inc: { tokenVersion: 1 } });
  }
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  res.status(204).end();
});

router.get('/me', requireUser, (req, res) => {
  res.json({ user: req.user.toPublic() });
});

router.patch(
  '/me',
  requireUser,
  validate(
    z.object({
      name: z.string().trim().min(1).max(80).optional(),
      language: z.enum(['rw', 'en', 'fr']).optional(),
    }),
  ),
  async (req, res) => {
    Object.assign(req.user, req.valid.body);
    await req.user.save();
    res.json({ user: req.user.toPublic() });
  },
);

export default router;
