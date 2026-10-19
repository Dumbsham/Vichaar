import { createContainer } from './container.js';
import { createServer } from './server.js';
import { logger } from './shared/logger.js';

const port = Number(process.env.PORT) || 4000;
const databaseUrl = process.env.DATABASE_URL || 'postgres://vichaar:vichaar_pass@localhost:5432/vichaar';
const databaseReplicaUrl = process.env.DATABASE_REPLICA_URL;

const container = createContainer({
  databaseUrl,
  databaseReplicaUrl,
});

const app = createServer(container);

const server = app.listen(port, () => {
  logger.info({ port }, `Vichaar API server listening on port ${port}`);
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Graceful shutdown initiated');
  server.close(async () => {
    logger.info('HTTP server closed');
    await container.close();
    logger.info('Database connections closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Shutdown timed out, forcefully exiting');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
