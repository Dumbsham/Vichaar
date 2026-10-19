import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

const { Pool } = pg;

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseClients {
  primary: Database;
  replica: Database;
  primaryPool: pg.Pool;
  replicaPool: pg.Pool;
  close: () => Promise<void>;
}

export interface DatabaseConfig {
  primaryUrl: string;
  replicaUrl?: string;
  maxConnections?: number;
}

export function createDatabaseClients(config: DatabaseConfig): DatabaseClients {
  const primaryPool = new Pool({
    connectionString: config.primaryUrl,
    max: config.maxConnections ?? 10,
  });

  const replicaPool = new Pool({
    connectionString: config.replicaUrl || config.primaryUrl,
    max: config.maxConnections ?? 10,
  });

  const primary = drizzle(primaryPool, { schema });
  const replica = drizzle(replicaPool, { schema });

  return {
    primary,
    replica,
    primaryPool,
    replicaPool,
    close: async () => {
      await Promise.all([primaryPool.end(), replicaPool.end()]);
    },
  };
}
