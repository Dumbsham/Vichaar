# ADR-006: ClickHouse for open and click events

Status: Proposed
Date: 2026-10-18

## Context
About 36 million events per year (0.7 per email), spiking to 400-500 per second at send time. Queries are rollups: opens per post per day, clicks per link.

## Options
1. Partitioned Postgres table.
2. ClickHouse.
3. Pre-aggregated counters only (no raw events).

## Decision
ClickHouse, with batched inserts (about 1,000 events or 1 second), `ReplacingMergeTree` keyed on `eventId`, and materialized views for rollups. No raw email addresses or IPs are stored.

## Consequences
- Analytics load is isolated from the primary database, and rollup queries are fast.
- At this volume Postgres would also work, so ClickHouse is partly a deliberate engineering choice. It costs memory on a 12 GB VM (capped at about 2 GB).
- One more service to run and back up.

## Revisit when
The stack is too heavy for the VM: fall back to a partitioned Postgres table with the same rollup queries behind an interface.