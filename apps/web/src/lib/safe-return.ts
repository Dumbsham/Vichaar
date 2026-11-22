export function safeReturnPath(value: string | undefined): string {
  if (value && /^\/p\/[a-z0-9-]{3,30}(?:\/[a-z0-9-]{1,160})?$/.test(value)) return value;
  if (value && /^\/account\/subscriptions(?:\?publicationId=[a-f0-9-]{36})?$/.test(value))
    return value;
  if (value && /^\/studio(?:\/[a-f0-9-]{36}(?:\/(?:readers|analytics|settings))?)?$/.test(value))
    return value;
  return '/account/subscriptions';
}
