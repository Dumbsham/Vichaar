import { cookies } from 'next/headers';
import { z } from 'zod';

const fullSchema = z.object({ htmlFull: z.string() });

export type FullPostResult =
  { state: 'full'; html: string } | { state: 'login' | 'subscribe' | 'unavailable' | 'missing' };

export async function getPrivatePost(subdomain: string, slug: string): Promise<FullPostResult> {
  const session = (await cookies()).get('vichaar_session')?.value;
  if (!session) return { state: 'login' };
  try {
    const origin = new URL(process.env.API_ORIGIN || 'http://127.0.0.1:4000').origin;
    const response = await fetch(
      `${origin}/public/${encodeURIComponent(subdomain)}/posts/${encodeURIComponent(slug)}/full`,
      {
        headers: { cookie: `vichaar_session=${session}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      },
    );
    if (response.status === 401) return { state: 'login' };
    if (response.status === 403) return { state: 'subscribe' };
    if (response.status === 404) return { state: 'missing' };
    if (!response.ok) return { state: 'unavailable' };
    const parsed = fullSchema.safeParse(await response.json());
    return parsed.success
      ? { state: 'full', html: parsed.data.htmlFull }
      : { state: 'unavailable' };
  } catch {
    return { state: 'unavailable' };
  }
}
