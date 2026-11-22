import { verifyToken } from '@vichaar/shared/tokens';
import { confirmationToken } from '@vichaar/shared/subscription-tokens';
import { NotFoundError, ValidationError } from '@vichaar/shared/errors';
import type { PublicationService } from '../publications/index.js';
import type { SubscriptionRepository } from './repository.js';
import type { SubscribeInput, PreferencesInput } from './schemas.js';

export interface SubscriptionService {
  listReaders(
    publicationId: string,
    ownerId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{
    items: Array<{ id: string; email: string; slot: string; timezone: string; joinedAt: string }>;
    nextCursor: string | null;
    hasMore: boolean;
  }>;
  subscribe(subdomain: string, input: SubscribeInput, correlationId: string): Promise<void>;
  confirm(token: string, correlationId: string): Promise<void>;
  unsubscribe(token: string): Promise<void>;
  updatePreferences(token: string, input: PreferencesInput): Promise<void>;
}
export function createSubscriptionService({
  repository,
  publicationService,
  tokenSecret,
}: {
  repository: SubscriptionRepository;
  publicationService: PublicationService;
  tokenSecret: string;
}): SubscriptionService {
  return {
    async listReaders(publicationId, ownerId, cursor, limit) {
      await publicationService.getOwned(publicationId, ownerId);
      const rows = await repository.listActive(publicationId, cursor, limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      return {
        items: page.map((row) => ({
          id: row.id,
          email: row.email,
          slot: row.slot,
          timezone: row.timezone,
          joinedAt: row.created_at.toISOString(),
        })),
        nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
        hasMore,
      };
    },
    async subscribe(subdomain, input, correlationId) {
      const publication = await publicationService.getBySubdomain(subdomain);
      await repository.request(
        publication.id,
        input,
        (id, exp) => confirmationToken(tokenSecret, publication.id, id, exp),
        correlationId,
      );
    },
    async confirm(token, correlationId) {
      const payload = verifyToken(token, tokenSecret);
      if (
        payload?.purpose !== 'confirm' ||
        typeof payload.publicationId !== 'string' ||
        typeof payload.subscriptionId !== 'string'
      )
        throw new ValidationError('Invalid or expired confirmation link');
      const changed = await repository.confirm(
        payload.publicationId,
        payload.subscriptionId,
        token,
        correlationId,
      );
      if (!changed) throw new ValidationError('Invalid or expired confirmation link');
    },
    async unsubscribe(token) {
      const payload = verifyToken(token, tokenSecret);
      if (
        payload?.purpose !== 'unsubscribe' ||
        typeof payload.publicationId !== 'string' ||
        typeof payload.subscriptionId !== 'string'
      )
        throw new NotFoundError();
      await repository.unsubscribe(payload.publicationId, payload.subscriptionId);
    },
    async updatePreferences(token, input) {
      const payload = verifyToken(token, tokenSecret);
      if (
        payload?.purpose !== 'unsubscribe' ||
        typeof payload.publicationId !== 'string' ||
        typeof payload.subscriptionId !== 'string'
      )
        throw new NotFoundError();
      const changed = await repository.updatePreferences(
        payload.publicationId,
        payload.subscriptionId,
        input,
      );
      if (!changed) throw new NotFoundError();
    },
  };
}
