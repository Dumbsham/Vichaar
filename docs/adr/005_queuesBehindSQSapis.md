# ADR-005: Queue accessed through the SQS API

Status: Proposed
Date: 2026-10-18

## Context
Burst-to-average ratio is about 600x on sends and opens spike with sends. Work must survive worker crashes. Demo budget is near zero, but the design should map to AWS.

## Options
1. **Amazon SQS** (ElasticMQ locally): managed durability, dead-letter queues, no broker to run in production.
2. **Kafka:** replay and multiple consumers, but heavy for one 12 GB VM.
3. **Redis-based queue (BullMQ):** easy, but Redis is not durable here by rule.
4. **Postgres-based queue (pg-boss):** one fewer service, but adds queue load to the primary.

## Decision
Code against the SQS API through a typed `Queue` interface. Standard queues (at least once, unordered), a dead-letter queue per queue, `maxReceiveCount` of 5, and visibility timeouts longer than worst-case processing.

## Consequences
- Same code runs on ElasticMQ in the demo and SQS in the blueprint.
- No ordering: design never relies on it.
- Messages are small (keys, not payloads).

## Revisit when
Replay or several independent consumers of one stream are needed (Kafka), or ElasticMQ proves unreliable (swap in pg-boss behind the same interface).