export interface PublicPreview {
  id: string;
  publicationId: string;
  slug: string;
  language: string;
  title: string;
  status: 'published';
  version: number;
  isPaid: boolean;
  scheduledFor: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  htmlPreview: string;
}
export interface PreviewCache {
  getOrLoad(key: string, load: () => Promise<PublicPreview>): Promise<PublicPreview>;
  invalidate(key: string): Promise<void>;
  stats(): { hits: number; misses: number; redisErrors: number };
  close(): Promise<void>;
}
export function previewCacheKey(subdomain: string, slug: string): string {
  return `post-preview:${subdomain}:${slug}`;
}
