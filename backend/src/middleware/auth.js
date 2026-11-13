import { Device } from '../models/Device.js';
import { User } from '../models/User.js';
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
