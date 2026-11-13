import { createApp } from './app.js';
import { config } from './config.js';
import { connectDb, disconnectDb } from './db.js';
import { logger } from './logger.js';

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info(`API listening on http://localhost:${config.PORT}/api/v1`);
});

connectDb();

function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await disconnectDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
