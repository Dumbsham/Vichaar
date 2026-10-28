# Phase 2 delivery implementation

This document describes the local Phase 2 code as implemented on 2026-10-28. The deployment blueprint in `docs/design.md` remains a plan; API and workers currently run as Node processes against Compose dependencies.

## Why the state is in PostgreSQL

Redis holds rate-limit tokens only. ElasticMQ carries work but may repeat or lose visibility of a message. PostgreSQL therefore holds subscriber consent, the immutable publish month, every delivery state, a durable scheduler cursor, and the transactional outbox. Publishing and requesting confirmation each insert an outbox event in the same transaction as their state change. A queue outage can delay work without losing it.

`subscriptions` has a unique `(publication_id, email)` constraint. A request leaves the row pending, stores only a hash of the signed confirmation token, and records the token expiry and a daily confirmation count. The outbox event contains IDs and expiry, never a usable token. The worker reconstructs the token with `TOKEN_HMAC_SECRET` and conditionally stamps `confirmation_dispatched_at` before its provider call. Confirmation changes `pending` to `active` and increments `subscriber_count` atomically; a replay does neither again. Unsubscribe adds a tenant suppression, decrements the counter once, and skips rows still pending or queued. The public response is the same `202` for an address that is already subscribed, pending, or suppressed.

`posts.delivery_month` is fixed in the publish transaction. Every recipient row copies it into `post_deliveries.send_month`, the partition key and final component of the primary key. Changing a pending `send_at` can cross calendar months without changing that key. This matters because replayed fan-out pages use `ON CONFLICT DO NOTHING`; a mutable partition key would permit a duplicate row and possibly a duplicate email. Monthly partitions are created for the current and next three months. If the default partition received rows during a maintenance gap, the maintenance command moves them while holding an exclusive parent-table lock, then attaches the month.

## Worker path

1. **Relay:** Selects up to 100 unpublished outbox rows with `FOR UPDATE SKIP LOCKED`, validates typed messages, sends them to `EventsQ`, and stamps `published_at` inside the lock transaction. A crash after queue acceptance can republish; consumers remain idempotent. The request correlation ID is carried through the event, delivery row, and send queue message into the sender span.
2. **Fan-out:** A `PostPublished` event or chained `FanoutPage` selects up to 1,000 active, unsuppressed subscribers using an ID cursor. One `INSERT ... SELECT` writes their pending delivery rows. A full page sends the next cursor job. The pure `computeSendAt` function uses the reader's timezone and 07:00, 13:00, or 20:00 local slot; `sendImmediately` uses database `now()` instead. A future scheduled post can be fanned out, but the scheduler will not queue it until the post becomes published.
3. **Scheduler:** Every 15 seconds, checks send-queue depth and pauses above 10,000 messages. A locked `scheduler_state` row rotates through up to 20 due publications. It claims up to 100 due rows per publication with `FOR UPDATE SKIP LOCKED`, respecting each publication's IST daily limit and current sending status. It updates rows to `queued` in a batch, commits, then sends batches of at most 100 keys to `SendQ`. A lost queue message leaves a recoverable `queued` row.
4. **Sender:** One `UPDATE ... RETURNING` changes an entire message's still-queued keys to `sending` and increments attempts. No provider call can occur for an unclaimed key. A joined read in the claim checks current subscription, suppression, publication, and post state. The sender uses Redis token buckets with a conservative local fallback and at most five concurrent provider calls. It writes results in one batched transaction. Paid posts use `html_preview` in email; full paid bodies are never sent to free readers in this phase.
5. **Sweeper:** Bounded passes mark `sending` rows older than ten minutes `failed: unknown_outcome`, return old `queued` rows to `pending`, and delete published outbox rows older than seven days. A `sending` row is never automatically resent after a crash.

An explicit SMTP 4xx rejection is known to precede acceptance, so it can return to `pending` with exponential backoff and jitter for at most five claims. An explicit SMTP 5xx rejection is permanent and adds a tenant suppression. Any ambiguous provider error, including a timeout after a request may have left, becomes `failed: unknown_outcome`. SES SDK send retries are disabled for the same reason. SES is available only in production to explicitly configured verified sandbox recipients; local SMTP points to Mailpit, and automated delivery tests use a stub.

## Running and observing it

```bash
pnpm stack:up
pnpm db:migrate
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
pnpm dev
```

`pnpm dev` starts separate relay, fan-out, scheduler, sender, and sweeper processes alongside the API. The API serves `/subscribe-demo`; Mailpit is at `http://localhost:8025`. The five worker `/metrics` endpoints use ports 9100–9104. They expose run, error, latency, queue-depth, sender result, retry, unknown-outcome, and CPU-millisecond counters. `sender_cpu_ms_total / sender_emails_total` is a measurement input, not a claimed throughput benchmark. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to a collector base URL to export queue and provider spans. The collector and alert-rule deployment are later work. Useful alerts include any `sender_unknown_outcome_total` increase, any dead-letter queue depth, growing send-queue age/depth, and worker error growth.

## Verification performed

- `pnpm lint` passed ESLint and strict TypeScript checks across all workspace packages; `pnpm build` passed all five package builds.
- `REDIS_TEST_URL=redis://localhost:6379 pnpm test` passed 39 tests in 13 files. The suite exercises the API, live PostgreSQL subscription and delivery states, timezone changes, daily limits, paid-body protection, a dedicated real Postgres/Redis/ElasticMQ pipeline with a stub provider, and a SIGKILL child sender test. The chaos test proves one accepted stub send, a stale `sending` row changed to `unknown_outcome`, and a replay unable to claim it again.
- A separate local smoke call to the SMTP provider was accepted and visible in Mailpit. No real email was sent.
- `EXPLAIN` with sequential scans disabled showed the due and pending-preference queries can use their partial indexes on each partition. This small local database is not a performance benchmark; the 500,000-recipient and 1,000/s goals remain unmeasured.

Open/click tracking URLs, bounce/complaint webhooks, platform-wide suppression, production alert rules, container limits, and load measurements remain in later phases. Direct post links are used until tracking endpoints exist.
