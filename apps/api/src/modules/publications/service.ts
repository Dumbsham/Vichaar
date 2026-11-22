import { ConflictError, NotFoundError } from '@vichaar/shared/errors';
import type { CreatePublicationInput, UpdatePublicationInput } from '@vichaar/shared/schemas';
import type { PublicationRepository, PublicationRow } from './repository.js';

export function publicationView(row: PublicationRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    subdomain: row.subdomain,
    description: row.description,
    monthlyPricePaise: row.monthly_price_paise,
    language: row.primary_language,
    sendingStatus: row.sending_status,
    dailySendLimit: row.daily_send_limit,
    subscriberCount: row.subscriber_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
export function publicPublicationView(row: PublicationRow) {
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    description: row.description,
    language: row.primary_language,
    monthlyPricePaise: row.monthly_price_paise,
  };
}
export interface PublicationService {
  create(
    ownerId: string,
    input: CreatePublicationInput,
  ): Promise<ReturnType<typeof publicationView>>;
  getOwned(publicationId: string, ownerId: string): Promise<ReturnType<typeof publicationView>>;
  getBySubdomain(subdomain: string): Promise<PublicationRow>;
  getPublic(subdomain: string): Promise<ReturnType<typeof publicPublicationView>>;
  listOwned(
    ownerId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{
    items: ReturnType<typeof publicationView>[];
    nextCursor: string | null;
    hasMore: boolean;
  }>;
  update(
    publicationId: string,
    ownerId: string,
    input: UpdatePublicationInput,
  ): Promise<ReturnType<typeof publicationView>>;
}
export function createPublicationService({
  publicationRepo,
}: {
  publicationRepo: PublicationRepository;
}): PublicationService {
  return {
    async create(ownerId, input) {
      const row = await publicationRepo.create(ownerId, input);
      if (!row) throw new ConflictError('Subdomain already exists');
      return publicationView(row);
    },
    async getOwned(publicationId, ownerId) {
      const row = await publicationRepo.findOwned(publicationId, ownerId);
      if (!row) throw new NotFoundError();
      return publicationView(row);
    },
    async getBySubdomain(subdomain) {
      const row = await publicationRepo.findBySubdomain(subdomain);
      if (!row) throw new NotFoundError();
      return row;
    },
    async getPublic(subdomain) {
      const row = await publicationRepo.findBySubdomain(subdomain);
      if (!row) throw new NotFoundError();
      return publicPublicationView(row);
    },
    async listOwned(ownerId, cursor, limit) {
      const rows = await publicationRepo.listOwned(ownerId, cursor, limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      return {
        items: page.map(publicationView),
        nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
        hasMore,
      };
    },
    async update(publicationId, ownerId, input) {
      const row = await publicationRepo.update(publicationId, ownerId, input);
      if (!row) throw new NotFoundError();
      return publicationView(row);
    },
  };
}
