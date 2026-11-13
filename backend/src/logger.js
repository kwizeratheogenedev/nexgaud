import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.isTest ? 'silent' : config.LOG_LEVEL,
  // Never write secrets or tokens to the logs.
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
});
