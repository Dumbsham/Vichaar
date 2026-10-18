# ADR-003: PostgreSQL as the single source of truth

Status: Proposed
Date: 2026-10-18

## Context
Relational data with strict rules: unique subscriptions, billing state, outbox rows, idempotency keys. Estimated 25 GB per year at full scale. Writes on the send path are batched to about 20 statements per second.

## Options
1. PostgreSQL.
2. MySQL.
3. MongoDB.

## Decision
PostgreSQL with Drizzle ORM. Unique constraints and transactions carry the correctness guarantees. `post_deliveries` is partitioned monthly (about 90 days hot). One read-replica container demonstrates the read path.

## Consequences
- Partitioned tables require the partition key inside every unique key, so the delivery primary key is `(post_id, subscription_id, send_month)`, where `send_month` is derived from the post and is identical for all rows of a post.
- One node is enough at this scale, so there is no sharding.
- Replica reads can lag, so a writer reading right after an edit reads from the primary.

## Revisit when
Load tests show the primary cannot sustain the batched send writes, or storage outgrows one node.