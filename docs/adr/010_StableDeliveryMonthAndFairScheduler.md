# ADR-010: Stable delivery partition key and fair scheduler cursor

Status: Accepted
Date: 2026-10-28

## Context

`post_deliveries` is partitioned by month, while a reader may change the timezone or slot of a pending delivery. Queue fan-out can replay. If the partition key follows the mutable `send_at`, a replay after a month-crossing preference change can insert a second row for the same post and subscriber. A large publication can also monopolize a naive `ORDER BY send_at LIMIT n` scheduler query.

## Options

1. Partition by each recipient's mutable send month and add a separate global deduplication table. This adds a hot write and another invariant to maintain.
2. Partition by the post's immutable publish month and store a durable publication cursor. This keeps all deliveries for one post in the same month and rotates scheduler capacity across publications.
3. Use a Redis cursor and queue delays. Redis is non-durable here, and queue delays cannot cover a reader's future slot.

## Decision

The publish transaction fixes `posts.delivery_month`. Every fan-out row copies it into `post_deliveries.send_month`; preference changes only update `send_at`. The composite primary key remains the duplicate guard under a replay. The scheduler locks a single `scheduler_state` cursor row, chooses up to 20 due publications in rotating ID order, then claims up to 100 due deliveries per publication with `FOR UPDATE SKIP LOCKED`. It counts already queued, sending, sent, and unknown-outcome rows in the current IST day against `daily_send_limit`. A queue depth above 10,000 pauses the tick. The default partition catches an unprovisioned month; maintenance moves any matching fallback rows under a table lock before attaching the monthly partition.

## Consequences

- Timezone changes cannot create a second delivery key for a post.
- A large publication cannot occupy every scheduler tick; the cursor and daily budget are durable.
- The partition month records the publish month, so a delivery scheduled months later may physically live in an older partition. Retention must account for the latest pending `send_at`, not only partition age.
- The cursor serializes scheduler ticks. That is deliberate for this single-VM deployment and avoids concurrent budget overshoot.
- Partition recovery briefly takes an exclusive lock; it is a maintenance operation, not a hot-path query.

## Revisit when

Measured scheduler latency or partition retention shows the cursor or publish-month grouping is a bottleneck. Any replacement must preserve a unique key across preference changes and fan-out replay.
