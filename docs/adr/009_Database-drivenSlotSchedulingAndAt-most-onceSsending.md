# ADR-009: Database-driven slot scheduling and at-most-once sending

Status: Proposed
Date: 2026-10-18

## Context
Readers choose a delivery slot. Up to 500,000 emails may be due in one 15-minute bucket (about 333 per second, target 1,000 per second). SQS delayed messages last at most 15 minutes. Duplicate newsletters annoy readers and raise spam complaints.

## Options for scheduling
1. SQS delay: cannot reach hours ahead.
2. One cloud timer per email: far too many objects.
3. **Rows with `send_at` in Postgres, claimed by a scheduler.**

## Options for sending semantics
1. At least once: retry on any doubt, accept occasional duplicates.
2. **At most once: claim a row before sending, never auto-resend when the outcome is unknown.**

## Decision
Fan-out inserts one `post_deliveries` row per recipient with its `send_at`. A scheduler moves due rows `pending -> queued` per publication round-robin, with backpressure when the send queue is deep, and enqueues batches. A sender moves `queued -> sending` in one atomic update. Only one worker can win, so a duplicate cannot be sent. Ambiguous outcomes (timeout after the request left) become `failed: unknown_outcome`, are counted, and are never resent automatically. A sweeper reclaims stuck rows.

## Consequences
- The database holds the schedule, so a crash loses nothing and the queue stays small.
- Guarantee: no duplicates. In a worker crash, up to the worker's concurrency limit of emails may have an unknown outcome. They are visible and countable, not silent.
- The README claim must read "no duplicate emails; in-flight emails at a crash are flagged", not "no lost emails".
- `post_deliveries` gets statuses `queued` and `sending` and an `updated_at` column.

## Revisit when
Measured unknown outcomes are non-trivial: then add a writer-triggered "resend to these" action, or switch to at-least-once with a provider that supports idempotency keys.