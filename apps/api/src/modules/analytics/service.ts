import type { PublicationService } from '../publications/index.js';
import type { createAnalyticsRepository } from './repository.js';

export function createAnalyticsService(deps: {
  publicationService: PublicationService;
  repo: ReturnType<typeof createAnalyticsRepository>;
}) {
  return {
    async stats(publicationId: string, ownerId: string) {
      await deps.publicationService.getOwned(publicationId, ownerId);
      return deps.repo.list(publicationId);
    },
  };
}
