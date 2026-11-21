import type { Pool } from '@vichaar/db';

export interface QuotePost {
  id: string;
  publication_id: string;
  title: string;
  language: string;
  access: 'free' | 'paid';
  html_preview: string;
  html_full: string;
}

export interface QuoteCardRepository {
  findPost(publicationId: string, slug: string): Promise<QuotePost | null>;
  findCard(publicationId: string, postId: string, hash: string): Promise<string | null>;
  putCard(publicationId: string, postId: string, hash: string, key: string): Promise<string | null>;
  findLiveCard(publicationId: string, slug: string, hash: string): Promise<string | null>;
}

export function createQuoteCardRepository(pool: Pool): QuoteCardRepository {
  return {
    async findPost(publicationId, slug) {
      const result = await pool.query<QuotePost>(
        `SELECT p.id,p.publication_id,p.title,p.language,p.access,c.html_preview,c.html_full
         FROM posts p JOIN post_contents c ON c.post_id=p.id AND c.publication_id=p.publication_id
         WHERE p.publication_id=$1 AND p.slug=$2 AND p.status='published'`,
        [publicationId, slug],
      );
      return result.rows[0] ?? null;
    },
    async findCard(publicationId, postId, hash) {
      const result = await pool.query<{ storage_key: string }>(
        'SELECT storage_key FROM quote_cards WHERE publication_id=$1 AND post_id=$2 AND quote_hash=$3',
        [publicationId, postId, hash],
      );
      return result.rows[0]?.storage_key ?? null;
    },
    async putCard(publicationId, postId, hash, key) {
      const result = await pool.query<{ storage_key: string }>(
        `WITH inserted AS (INSERT INTO quote_cards(publication_id,post_id,quote_hash,storage_key)
          SELECT $1,$2,$3,$4 FROM posts p WHERE p.publication_id=$1 AND p.id=$2 AND p.status='published'
          ON CONFLICT (post_id,quote_hash) DO NOTHING RETURNING storage_key)
         SELECT storage_key FROM inserted
         UNION ALL SELECT storage_key FROM quote_cards WHERE publication_id=$1 AND post_id=$2 AND quote_hash=$3
         LIMIT 1`,
        [publicationId, postId, hash, key],
      );
      return result.rows[0]?.storage_key ?? null;
    },
    async findLiveCard(publicationId, slug, hash) {
      const result = await pool.query<{ storage_key: string }>(
        `SELECT q.storage_key FROM quote_cards q JOIN posts p
         ON p.id=q.post_id AND p.publication_id=q.publication_id
         WHERE q.publication_id=$1 AND p.slug=$2 AND p.status='published' AND q.quote_hash=$3`,
        [publicationId, slug, hash],
      );
      return result.rows[0]?.storage_key ?? null;
    },
  };
}
