import type { PublicationService } from '../publications/index.js';
import type { MilestoneRepository } from './repository.js';

export function createMilestoneService(deps: {
  publicationService: PublicationService;
  repository: MilestoneRepository;
}) {
  return {
    async list(publicationId: string, ownerId: string) {
      await deps.publicationService.getOwned(publicationId, ownerId);
      return deps.repository.list(publicationId);
    },
  };
}
