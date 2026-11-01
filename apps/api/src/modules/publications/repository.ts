import type { Pool } from '@vichaar/db';
import { generateId } from '@vichaar/db';
import type { CreatePublicationInput, UpdatePublicationInput } from '@vichaar/shared/schemas';

export interface PublicationRow {
  id: string;
  owner_id: string;
  name: string;
  subdomain: string;
  description: string | null;
  primary_language: string;
  monthly_price_paise: number;
  sending_status: 'active' | 'paused';
  daily_send_limit: number;
  subscriber_count: number;
  created_at: Date;
  updated_at: Date;
}
export interface PublicationRepository {
  create(ownerId: string, input: CreatePublicationInput): Promise<PublicationRow | null>;
  findOwned(publicationId: string, ownerId: string): Promise<PublicationRow | null>;
  findBySubdomain(subdomain: string): Promise<PublicationRow | null>;
  listOwned(ownerId: string, cursor: string | undefined, limit: number): Promise<PublicationRow[]>;
  update(
    publicationId: string,
    ownerId: string,
    input: UpdatePublicationInput,
  ): Promise<PublicationRow | null>;
}
export function createPublicationRepository({ pool, readPool = pool }: { pool: Pool; readPool?: Pool }): PublicationRepository {
  return {
    async create(ownerId, input) {
      const result = await pool.query<PublicationRow>(
        `INSERT INTO publications (id,owner_id,name,subdomain,description,monthly_price_paise,primary_language)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (subdomain) DO NOTHING RETURNING *`,
        [
          generateId(),
          ownerId,
          input.name,
          input.subdomain,
          input.description ?? null,
          input.monthlyPricePaise,
          input.language,
        ],
      );
      return result.rows[0] ?? null;
    },
    async findOwned(publicationId, ownerId) {
      const result = await pool.query<PublicationRow>(
        'SELECT * FROM publications WHERE id=$1 AND owner_id=$2',
        [publicationId, ownerId],
      );
      return result.rows[0] ?? null;
    },
    async findBySubdomain(subdomain) {
      const sql = 'SELECT * FROM publications WHERE subdomain=$1';
      let result;
      try { result = await readPool.query<PublicationRow>(sql, [subdomain]); }
      catch { result = await pool.query<PublicationRow>(sql, [subdomain]); }
      return result.rows[0] ?? null;
    },
    async listOwned(ownerId, cursor, limit) {
      const result = await pool.query<PublicationRow>(
        'SELECT * FROM publications WHERE owner_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3',
        [ownerId, cursor ?? null, limit],
      );
      return result.rows;
    },
    async update(publicationId, ownerId, input) {
      const result = await pool.query<PublicationRow>(
        `UPDATE publications SET name=COALESCE($3,name), description=COALESCE($4,description),
         monthly_price_paise=COALESCE($5,monthly_price_paise), primary_language=COALESCE($6,primary_language), updated_at=now()
         WHERE id=$1 AND owner_id=$2 RETURNING *`,
        [
          publicationId,
          ownerId,
          input.name ?? null,
          input.description ?? null,
          input.monthlyPricePaise ?? null,
          input.language ?? null,
        ],
      );
      return result.rows[0] ?? null;
    },
  };
}
