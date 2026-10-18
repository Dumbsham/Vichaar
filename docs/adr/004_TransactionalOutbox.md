# ADR-004: Transactional outbox for domain events

Status: Proposed
Date: 2026-10-18

## Context
Publishing must save the post and announce it to the send pipeline. Doing both separately (write database, then send to queue) can lose the event if the process dies between them, or announce a post that rolled back.

## Options
1. **Dual write** (database then queue): simple, but unsafe.
2. **Change data capture** (for example Debezium): robust, heavy to run on one small VM.
3. **LISTEN/NOTIFY only:** lightweight, but notifications are lost if nobody is listening.
4. **Outbox table plus polling relay.**

## Decision
Option 4. The state change and the `outbox_events` row are written in one transaction. A relay polls with `FOR UPDATE SKIP LOCKED`, sends to the queue, then marks the row published.

## Consequences
- Events are never lost, and never announced for rolled-back changes.
- Delivery to the queue is at least once, so all consumers are idempotent.
- Latency is about the poll interval (around 1 second). Published rows are deleted after 7 days.

## Revisit when
Event volume makes polling a measurable load, or sub-second latency is needed (then add LISTEN/NOTIFY as a wake-up signal).