import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../logger.js';

/**
 * Records who did what. Pass the request (to take the signed-in user or the partner's API key)
 * and what changed. Never throws: a failed audit write is logged, the action itself still counts.
 */
export async function audit(req, action, target, details) {
  try {
    await AuditLog.create({
      actorId: req?.user?._id,
      actorRole: req?.partnerAuth === 'api_key' ? 'partner_api' : req?.user?.role,
      partnerId: req?.partner?._id,
      action,
      targetType: target?.constructor?.modelName,
      targetId: target?._id,
      details,
    });
  } catch (err) {
    logger.error({ err: err.message, action }, 'Audit log write failed');
  }
}
