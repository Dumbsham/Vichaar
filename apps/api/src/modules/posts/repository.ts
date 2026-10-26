import type { Pool } from '@vichaar/db';
import { generateId } from '@vichaar/db';
import type { CreatePostInput, UpdatePostInput } from '@vichaar/shared/schemas';

export interface PostRow {
  id: string;
  publication_id: string;
  slug: string;
  title: string;
  language: string;
  access: 'free' | 'paid';
  status: 'draft' | 'scheduled' | 'published';
  scheduled_for: Date | null;
  published_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  body_json?: { html?: string };
  html_preview?: string;
  html_full?: string;
}
export type PublishResult = { row: PostRow; published: boolean } | null;
export interface PostRepository {
  create(
    publicationId: string,
    input: CreatePostInput,
    slug: string,
    language: string,
  ): Promise<PostRow | null>;
  find(publicationId: string, postId: string): Promise<PostRow | null>;
  findPublic(publicationId: string, slug: string): Promise<PostRow | null>;
  update(publicationId: string, postId: string, input: UpdatePostInput): Promise<PostRow | null>;
  list(publicationId: string, cursor: string | undefined, limit: number): Promise<PostRow[]>;
  publish(input: {
    publicationId: string;
    postId: string;
    expectedVersion: number;
    htmlFull: string;
    htmlPreview: string;
    links: string[];
    sendImmediately: boolean;
    scheduledFor: Date | null;
    now: Date;
    weekStart: string;
  }): Promise<PublishResult>;
}
export function createPostRepository({ pool }: { pool: Pool }): PostRepository {
  return {
    async create(publicationId, input, slug, language) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query<PostRow>(
          `INSERT INTO posts (id,publication_id,slug,title,language,access,scheduled_for)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (publication_id,slug) DO NOTHING RETURNING *`,
          [
            generateId(),
            publicationId,
            slug,
            input.title,
            language,
            input.isPaid ? 'paid' : 'free',
            input.scheduledFor ?? null,
          ],
        );
        const row = result.rows[0];
        if (row)
          await client.query(
            'INSERT INTO post_contents (post_id,publication_id,body_json) VALUES ($1,$2,$3)',
            [row.id, publicationId, { html: input.body }],
          );
        await client.query('COMMIT');
        return row ?? null;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async find(publicationId, postId) {
      const result = await pool.query<PostRow>(
        `SELECT p.*, c.body_json, c.html_preview, c.html_full FROM posts p
         JOIN post_contents c ON c.post_id=p.id AND c.publication_id=p.publication_id
         WHERE p.publication_id=$1 AND p.id=$2`,
        [publicationId, postId],
      );
      return result.rows[0] ?? null;
    },
    async findPublic(publicationId, slug) {
      const result = await pool.query<PostRow>(
        `SELECT p.*, c.html_preview FROM posts p JOIN post_contents c
         ON c.post_id=p.id AND c.publication_id=p.publication_id
         WHERE p.publication_id=$1 AND p.slug=$2 AND p.status='published'`,
        [publicationId, slug],
      );
      return result.rows[0] ?? null;
    },
    async update(publicationId, postId, input) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query<PostRow>(
          `UPDATE posts SET title=COALESCE($4,title), slug=COALESCE($5,slug), access=COALESCE($6,access),
           scheduled_for=CASE WHEN $8::boolean THEN $7::timestamptz ELSE scheduled_for END,
           language=COALESCE($9,language), version=version+1, updated_at=now()
           WHERE publication_id=$1 AND id=$2 AND version=$3 AND status='draft' RETURNING *`,
          [
            publicationId,
            postId,
            input.version,
            input.title ?? null,
            input.slug ?? null,
            input.isPaid === undefined ? null : input.isPaid ? 'paid' : 'free',
            input.scheduledFor ?? null,
            input.scheduledFor !== undefined,
            input.language ?? null,
          ],
        );
        const row = result.rows[0];
        if (row && input.body !== undefined)
          await client.query(
            'UPDATE post_contents SET body_json=$3 WHERE publication_id=$1 AND post_id=$2',
            [publicationId, postId, { html: input.body }],
          );
        await client.query('COMMIT');
        return row ?? null;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async list(publicationId, cursor, limit) {
      const result = await pool.query<PostRow>(
        'SELECT * FROM posts WHERE publication_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3',
        [publicationId, cursor ?? null, limit],
      );
      return result.rows;
    },
    async publish(input) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query<PostRow>(
          'SELECT * FROM posts WHERE publication_id=$1 AND id=$2 FOR UPDATE',
          [input.publicationId, input.postId],
        );
        const current = existing.rows[0];
        if (!current) {
          await client.query('COMMIT');
          return null;
        }
        if (current.status !== 'draft') {
          await client.query('COMMIT');
          return { row: current, published: false };
        }
        if (current.version !== input.expectedVersion) {
          await client.query('COMMIT');
          return null;
        }
        const status =
          input.scheduledFor && input.scheduledFor > input.now ? 'scheduled' : 'published';
        const updated = await client.query<PostRow>(
          `UPDATE posts SET status=$3,published_at=$4,version=version+1,updated_at=$5
           WHERE publication_id=$1 AND id=$2 RETURNING *`,
          [
            input.publicationId,
            input.postId,
            status,
            status === 'published' ? input.now : null,
            input.now,
          ],
        );
        await client.query(
          'UPDATE post_contents SET html_full=$3,html_preview=$4 WHERE publication_id=$1 AND post_id=$2',
          [input.publicationId, input.postId, input.htmlFull, input.htmlPreview],
        );
        await client.query('DELETE FROM tracked_links WHERE publication_id=$1 AND post_id=$2', [
          input.publicationId,
          input.postId,
        ]);
        if (input.links.length > 0)
          await client.query(
            `INSERT INTO tracked_links (id,publication_id,post_id,target_url)
           SELECT id::uuid,$1::uuid,$2::uuid,url FROM unnest($3::text[],$4::text[]) AS links(id,url)`,
            [input.publicationId, input.postId, input.links.map(() => generateId()), input.links],
          );
        if (status === 'published')
          await client.query(
            `INSERT INTO writing_streaks (publication_id,current_weeks,longest_weeks,last_post_week)
           VALUES ($1,1,1,$2::date) ON CONFLICT (publication_id) DO UPDATE SET
           current_weeks=CASE WHEN writing_streaks.last_post_week=$2::date THEN writing_streaks.current_weeks
             WHEN writing_streaks.last_post_week=$2::date - 7 THEN writing_streaks.current_weeks+1 ELSE 1 END,
           longest_weeks=GREATEST(writing_streaks.longest_weeks, CASE WHEN writing_streaks.last_post_week=$2::date - 7 THEN writing_streaks.current_weeks+1 ELSE 1 END),
           last_post_week=$2::date`,
            [input.publicationId, input.weekStart],
          );
        await client.query('INSERT INTO outbox_events (event_type,payload) VALUES ($1,$2)', [
          'PostPublished',
          {
            postId: input.postId,
            publicationId: input.publicationId,
            scheduledFor: input.scheduledFor?.toISOString() ?? null,
            sendImmediately: input.sendImmediately,
          },
        ]);
        await client.query('COMMIT');
        return { row: updated.rows[0]!, published: true };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
