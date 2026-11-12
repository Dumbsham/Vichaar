# ADR-013: Isolated tracking process and ClickHouse event rollups

Status: Accepted
Date: 2026-11-12

## Context

Open pixels and click redirects face bursty traffic. Analytics storage can be slow or unavailable. The main API and PostgreSQL must not ingest each tracking event. A redirect target must be a URL stored against a published post, not a URL supplied by the requester.

## Options

1. Write events synchronously from the main API to PostgreSQL: simple, but couples reader navigation to analytics and adds event write load to the source of truth.
2. Run a separate tracking listener, buffer events, send batches to TrackQ, and insert them into ClickHouse: isolates load and makes analytics eventually consistent.

## Decision

Use option 2. Email links carry short signed HMAC tokens identifying publication, post, subscription and stored link ID. The tracking listener verifies tokens, resolves click destinations from publication-scoped tracked links, and responds before queue flushing. Its bounded buffer drops events and increments a metric when full or when queue publication fails. The analytics worker inserts up to 1,000 events per receive batch into ClickHouse. A materialized view stores aggregate states keyed by publication, post, UTC day and event type; distinct event IDs make retries idempotent in counts. Prefetch events remain in the raw table but are excluded from rollups.

## Consequences

- Analytics may lose events during TrackQ outages or tracking-process crashes; the dropped counter and queue depth expose this. No reader address or IP is stored in ClickHouse.
- An uncached click still needs PostgreSQL to resolve the stored target. If that lookup fails, the endpoint returns 404 rather than redirecting to an unverified URL. A bounded target cache is a future reliability improvement.
- Local demo runs tracking and analytics as Node processes against Compose dependencies. ClickHouse rollups are not a production benchmark.

## Revisit when

Measured event loss or lookup latency is material, or a replayable durable event buffer is required.
