import mongoose from 'mongoose';
import { config } from './config.js';
import { logger } from './logger.js';

const STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

export function dbState() {
  return STATES[mongoose.connection.readyState] ?? 'unknown';
}

// Keeps retrying so the API stays up (and /health reports it) while the database is unreachable.
export async function connectDb(retryMs = 5000) {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  for (;;) {
    try {
      await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
      return;
    } catch (err) {
      logger.error({ err: err.message }, `MongoDB connection failed, retrying in ${retryMs / 1000}s`);
      await new Promise((r) => setTimeout(r, retryMs));
    }
  }
}

export function disconnectDb() {
  return mongoose.disconnect();
}
