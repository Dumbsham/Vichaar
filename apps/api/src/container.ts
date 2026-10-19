import { createDatabaseClients, DatabaseClients } from '@vichaar/db';
import { createHealthRepository, createHealthService, HealthService } from './modules/health/index.js';

export interface AppContainer {
  db?: DatabaseClients;
  healthService: HealthService;
  close: () => Promise<void>;
}

export interface ContainerConfig {
  databaseUrl: string;
  databaseReplicaUrl?: string;
}

export function createContainer(config: ContainerConfig): AppContainer {
  const db = createDatabaseClients({
    primaryUrl: config.databaseUrl,
    replicaUrl: config.databaseReplicaUrl,
  });

  const healthRepo = createHealthRepository({ pool: db.primaryPool });
  const healthService = createHealthService({ healthRepo });

  return {
    db,
    healthService,
    close: async () => {
      await db.close();
    },
  };
}
