# ADR-008: Paid access decided from the database, cached in Redis

Status: Proposed
Date: 2026-10-18

## Context
Access to paid posts depends on payment state that changes by webhook, possibly late, duplicated, out of order, or lost. Wrong answers cost either money (free access) or trust (a paying reader locked out).

## Options
1. Put an entitlement claim in the login session or token: fast, but stale for its whole lifetime.
2. Always query Postgres: correct, but a database hit on every paid read.
3. Cache in Redis with a short TTL, cleared by the webhook processor.

## Decision
Option 3. Truth is `paid_subscriptions`. Entitled when status is `active`, or cancelled with `current_period_end` in the future. Redis TTL 60 seconds, deleted after each processed event. On a miss or Redis failure, read Postgres. If Postgres is also unavailable, return 503, not 403. An hourly reconciliation job asks Razorpay for current state and applies it through the same transition code as webhooks. Out-of-order events are ignored using `last_event_at`.

## Consequences
- Access is at most about 60 seconds stale in the worst case, and lost webhooks are repaired within about an hour.
- One transition function serves webhooks and reconciliation, so there is one place to test.

## Revisit when
Paid reads are heavy enough that the database fallback becomes a load problem.