import type { Pool } from '@vichaar/db';

export function createTrackingRepository(pool: Pool) {
  return {
    async findTarget(
      publicationId: string,
      postId: string,
      linkId: string,
    ): Promise<string | null> {
      const result = await pool.query<{ target_url: string }>(
        `SELECT l.target_url FROM tracked_links l JOIN posts p ON p.id=l.post_id AND p.publication_id=l.publication_id
         WHERE l.publication_id=$1 AND l.post_id=$2 AND l.id=$3 AND p.status='published'`,
        [publicationId, postId, linkId],
      );
      return result.rows[0]?.target_url ?? null;
    },
  };
}
