import { z } from 'zod';

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Could not reach Vichaar. Please try again.';
  if (error.status === 429) return 'Too many requests. Please wait a minute and try again.';
  if (error.status === 503)
    return 'This service is temporarily unavailable. Please try again soon.';
  return error.message;
}

export async function apiRequest<T extends z.ZodType>(
  path: string,
  schema: T,
  options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
): Promise<z.output<T>> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new ApiError(503, 'Could not reach Vichaar. Please try again.');
  }
  if (!response.ok) {
    const parsed = errorSchema.safeParse(await response.json().catch(() => null));
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error.message : 'Request failed',
    );
  }
  if (response.status === 204) return schema.parse(undefined);
  return schema.parse(await response.json());
}
