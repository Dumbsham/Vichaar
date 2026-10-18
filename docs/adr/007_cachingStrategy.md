# ADR-007: Layered caching, with paid content never in shared cache

Status: Proposed
Date: 2026-10-18

## Context
Reads are write-once, read-many. Average 3.5 requests per second, a viral post about 83 per second, target 1,000 cached and 100 uncached per second. A leak of paid content through a shared cache is the worst failure.

## Decision
1. Render posts to static HTML at publish time.
2. Layers: CDN (Cloudflare), then Redis, then replica or primary.
3. Cache only content that is read often, identical for everyone, harmless if slightly stale, and expensive to produce.
4. Public preview: `public, s-maxage=60, stale-while-revalidate`, `ETag` from the post `version`. Invalidate only the changed post and list pages on edit or unpublish.
5. The paid body is served from a separate authenticated endpoint with `private, no-store` and is never placed in a shared cache.
6. Stampede protection: single-flight per key, jittered TTLs, stale-while-revalidate.
7. Never cached: webhooks, tracking endpoints, write actions.

## Consequences
- Reads survive traffic spikes and brief database outages.
- Invalidation must be correct, so the cache key includes publication, post and language.

## Revisit when
The cache hit ratio falls below 90%, or personalized pages are introduced.