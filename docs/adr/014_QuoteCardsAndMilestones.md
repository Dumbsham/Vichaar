# ADR-014: Local quote-card storage and milestone processing

Status: Accepted
Date: 2026-11-21

## Context

Phase 6 needs shareable image cards without exposing paid post text, plus celebrations that cannot fire twice when the queue replays a confirmation. The demo runs on one host with a small API memory budget. The Next.js frontend and production object storage are later phases.

## Options

1. Store PNG bytes in PostgreSQL. This makes cleanup transactional but grows the source-of-truth database with image data.
2. Store PNGs on the demo host through an `ObjectStorage` interface, with metadata and uniqueness in PostgreSQL. Use the same interface for a future object-store implementation.
3. Render cards on every request. This avoids storage but spends CPU repeatedly and removes stable image URLs.

## Decision

Use option 2. Normalize and validate an allowed quote before rendering. The key is SHA-256 of post ID, normalized quote, and template version. A `(post_id, quote_hash)` primary key makes the metadata idempotent. Satori and resvg render a 1200×630 PNG with bundled Noto Sans Latin, Devanagari, or Tamil fonts. The API admits at most two active renders and ten waiting requests, with a five-second response timeout and an IP rate limit. The local store is `QUOTE_CARD_DIR`; the demo API and fanout worker must share this directory. The image endpoint checks the post is still published and uses a 60-second public cache lifetime so unpublish takes effect at the edge.

Unpublish records `PostUnpublished` in the same transaction as the status change. The existing event worker removes matching files and rows; deletion is idempotent on replay. An in-flight render rechecks publication state before inserting metadata.

Confirmation records `SubscriptionConfirmed` in the same transaction as the counter increment. The event worker inserts reached thresholds (10, 100, 1,000) with `ON CONFLICT DO NOTHING`; only newly inserted rows trigger a writer email. The row is the durable celebration record. A failed notification increments a metric and is not retried automatically, because the outcome of an email send can be ambiguous.

## Consequences

- Card files need shared persistent storage in any multi-process demo deployment. The S3 implementation is only a production blueprint and is not deployed.
- A card URL remains readable for up to the 60-second cache lifetime after unpublish. Failed cleanup remains visible through worker errors and can be retried via the outbox event.
- Milestone history is exactly once. Notification delivery is at most once; a provider failure can leave a milestone without an email.
- Full web typography and card creation controls belong to the later Next.js frontend phase.

## Revisit when

The demo runs across hosts, measured render demand exceeds the two-render cap, or writer notification loss warrants a provider with an idempotency key.
