import {
  publicPostListSchema,
  publicPostPreviewSchema,
  publicPublicationSchema,
  type PublicPostList,
  type PublicPostPreview,
  type PublicPublication,
} from './schemas';
import type { z } from 'zod';

export class PublicApiError extends Error {
  constructor(readonly status: number) {
    super(status === 404 ? 'Not found' : 'The publication could not be loaded');
  }
}

async function readPublic<T extends z.ZodType>(path: string, schema: T): Promise<z.output<T>> {
  const origin = new URL(process.env.API_ORIGIN || 'http://127.0.0.1:4000').origin;
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new PublicApiError(503);
  }
  if (!response.ok) throw new PublicApiError(response.status);
  try {
    return schema.parse(await response.json());
  } catch {
    throw new PublicApiError(503);
  }
}

export function getPublicPublication(subdomain: string): Promise<PublicPublication> {
  return readPublic(`/public/${encodeURIComponent(subdomain)}`, publicPublicationSchema);
}

export function listPublicPosts(subdomain: string, cursor?: string): Promise<PublicPostList> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return readPublic(`/public/${encodeURIComponent(subdomain)}/posts${query}`, publicPostListSchema);
}

export function getPublicPost(subdomain: string, slug: string): Promise<PublicPostPreview> {
  return readPublic(
    `/public/${encodeURIComponent(subdomain)}/posts/${encodeURIComponent(slug)}`,
    publicPostPreviewSchema,
  );
}
