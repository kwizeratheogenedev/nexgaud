import { Device } from '../models/Device.js';
import { User } from '../models/User.js';
import { Partner } from '../models/Partner.js';
import { hmac } from '../lib/crypto.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyToken } from '../services/tokens.js';

function bearer(req, scheme) {
  const header = req.get('authorization') ?? '';
  const [kind, value] = header.split(' ');
  return kind?.toLowerCase() === scheme.toLowerCase() && value ? value : null;
}

/** People: `Authorization: Bearer <access token>`. Sets req.user. */
export async function requireUser(req, _res, next) {
  const payload = verifyToken(bearer(req, 'Bearer'), 'access');
  if (!payload) return next(unauthorized());
  const user = await User.findById(payload.sub);
  if (!user) return next(unauthorized());
  req.user = user;
  next();
}

/** Use after requireUser: only these roles may continue. */
export function requireRole(...roles) {
  return (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));
}

/** Phones:`Authorization: Device <device token>`. Sets req.device. */
export async function requireDevice(req, _res, next) {
  const token = bearer(req, 'Device');
  if (!token) return next(unauthorized('Device token missing'));
  const device = await Device.findOne({ tokenHash: hmac(token) });
  if (!device) return next(unauthorized('Device is not paired'));
  req.device = device;
  next();
}

/**
 * Partner shops and the police: either a member signed in to the partner portal (Bearer token,
 * role shop or police, with a partnerId), or the partner's own system with `Authorization: ApiKey <key>`.
 * Sets req.partner and req.partnerAuth ('portal' or 'api_key').
 */
export async function requirePartner(req, res, next) {
  const key = bearer(req, 'ApiKey');
  if (key) {
    const partner = await Partner.findOne({ 'apiKeys.hash': hmac(key) });
    const apiKey = partner?.apiKeys.find((k) => k.hash === hmac(key));
    if (!partner || !apiKey || apiKey.revokedAt) return next(unauthorized('Unknown or revoked API key'));
    if (partner.status !== 'active') return next(forbidden('This partner account is suspended'));
    req.partner = partner;
    req.partnerAuth = 'api_key';
    // At most one write a minute per key.
    if (!apiKey.lastUsedAt || Date.now() - apiKey.lastUsedAt.getTime() > 60000) {
      await Partner.updateOne({ _id: partner._id, 'apiKeys._id': apiKey._id }, { $set: { 'apiKeys.$.lastUsedAt': new Date() } });
    }
    return next();
  }
  await requireUser(req, res, async (err) => {
    if (err) return next(err);
    if (!['shop', 'police'].includes(req.user.role) || !req.user.partnerId) return next(forbidden('Only partner accounts can do this'));
    const partner = await Partner.findById(req.user.partnerId);
    if (!partner) return next(forbidden('Only partner accounts can do this'));
    if (partner.status !== 'active') return next(forbidden('This partner account is suspended'));
    req.partner = partner;
    req.partnerAuth = 'portal';
    next();
  });
}
