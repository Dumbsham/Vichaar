import { HealthRepository } from './repository.js';
import { HealthResponse, ReadinessResponse } from './schemas.js';

export interface HealthService {
  getLiveness(): HealthResponse;
  getReadiness(): Promise<ReadinessResponse>;
}

export function createHealthService({
  healthRepo,
}: {
  healthRepo: HealthRepository;
}): HealthService {
  return {
    getLiveness(): HealthResponse {
      return {
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      };
    },

    async getReadiness(): Promise<ReadinessResponse> {
      const isDbConnected = await healthRepo.pingDatabase();
      return {
        status: isDbConnected ? 'ok' : 'unhealthy',
        database: isDbConnected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
      };
    },
  };
}
