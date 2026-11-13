import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const ISSUER = 'nexguard';

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, typ: 'access' }, config.jwtSecret, {
    expiresIn: config.ACCESS_TOKEN_TTL,
    issuer: ISSUER,
  });
}

export function signRefreshToken(user) {
  return jwt.sign({ sub: user.id, ver: user.tokenVersion, typ: 'refresh' }, config.jwtSecret, {
    expiresIn: `${config.REFRESH_TOKEN_TTL_DAYS}d`,
    issuer: ISSUER,
  });
}

/** Returns the payload, or null when the token is invalid, expired or the wrong type. */
export function verifyToken(token, typ) {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { issuer: ISSUER, algorithms: ['HS256'] });
    return payload.typ === typ ? payload : null;
  } catch {
    return null;
  }
}
