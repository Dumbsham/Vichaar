# Failure analysis

Status: draft v1. For each component: what happens when it is **down**, **slow**, or **delivers twice**, how we notice, and how we recover.

## Principles
- Readers can always read. Cached pages survive most failures.
- A reader's click is never blocked by analytics.
- Duplicate emails are worse than a flagged lost one (ADR-009).
- Uncertain access fails closed, but a paying reader gets "try again", not "no".
- Every retry is bounded, backed off with jitter, and ends in a dead-letter queue.

## Component failures

| Component | When it is down | When it is slow | Detect | Recover |
|---|---|---|---|---|
| **Postgres primary** | Writes return 503. Cached pages and cached entitlements keep serving. Workers retry with backoff. Sends pause because rows cannot be claimed. Queues hold the work. | Statement and pool timeouts keep requests from piling up. Sender concurrency drops. | `/readyz` fails, connection errors, query latency | Restart or restore from backup. Queued work resumes. |
| **Read replica** | Reads fall back to the primary (watch its load). Writers always read from the primary. | Replication lag shows as stale lists. Acceptable for public reads. | Lag metric, alert on high lag | Rebuild the replica |
| **Redis** | Cache misses go to the database, rate limiting switches to the in-memory limiter, entitlements read Postgres. Stampede protection limits the extra load. | Short client timeouts, treat as a miss | Redis errors, cache hit ratio drop | Restart. It warms up on its own. |
| **Queue (ElasticMQ / SQS)** | Publishing still works because the outbox keeps rows. The relay retries. Tracking buffers briefly, then drops events and counts them. Sends pause. | Queue age grows. Scheduler backpressure stops adding work. | Oldest-message-age alert | The outbox and `pending` rows drain on recovery |
| **Email provider** | Retryable errors return rows to `queued` with backoff. A circuit breaker pauses sending for a few minutes. No data loss. | Per-call timeouts and a concurrency cap. Timeouts after the request left become `unknown_outcome`. | Error and throttle rates, unknown-outcome count | Breaker closes by itself once calls succeed |
| **Razorpay** | Checkout shows a clear message. Existing access is unaffected (cached and database state). Reconciliation retries later. | Timeouts on checkout and reconciliation calls | Error rate on provider calls | Hourly reconciliation repairs state |
| **ClickHouse** | Redirects and pixels still work. The tracking queue grows. Dashboards show a "data delayed" note. | Batches grow, consumer lag appears | Queue age on tracking queue | Backlog drains after recovery. Retention of the queue bounds how long it can be down. |
| **Object storage / disk for cards** | Quote cards return 503. Posts and emails are unaffected. | Render timeout | Error rate on card endpoint | Restore storage; cards are regenerated on demand |
| **Cloudflare** | Site unreachable. Accepted risk for a demo. | - | External uptime monitor | Wait, or point DNS directly at the VM |
| **The single VM** | Everything is down. This is the main single point of failure. | Disk full, memory pressure | Disk alerts at 80%, container memory alerts, uptime monitor | Rebuild from Compose files and the latest backup. Daily `pg_dump` means up to about 24 hours of data could be lost. State this honestly. |

## Worker crashes

| Crash point | Result |
|---|---|
| Sender after claiming rows, before sending | Rows stay `sending`. The sweeper marks them `unknown_outcome` after 10 minutes. No duplicate. |
| Sender after sending, before recording | Same: flagged unknown, never resent. |
| Sender before claiming | Queue message reappears after the visibility timeout, and another worker claims it. |
| Fan-out mid-page | The page job reappears. Inserts are `ON CONFLICT DO NOTHING`, so repeating is safe. |
| Outbox relay after enqueue, before marking | Event is republished. Consumers are idempotent. A duplicate fan-out is wasteful but safe. |
| Scheduler | Two schedulers cannot claim the same row (`SKIP LOCKED`). Rows left `queued` too long are returned to `pending`. |
| Webhook worker | Message reappears and the event is processed again. `last_event_at` and the unique event id make it safe. |
| Analytics consumer | Acknowledged only after the insert. A repeat is deduplicated by `eventId`. |

## Duplicates and disorder

| What repeats or reorders | Why it is safe |
|---|---|
| Double-click on Publish | The conditional update `WHERE status='draft'` changes zero rows the second time, so no second outbox event |
| Subscribe twice | Unique `(publication_id, email)`. Response is always 202. |
| Confirm link clicked twice | Conditional update `pending -> active` runs once, so the counter increments once |
| Same webhook delivered twice | Unique `provider_event_id` |
| Webhooks out of order | Ignored if not newer than `last_event_at` |
| Queue delivers a message twice | Row-level claim (sender), idempotent inserts (fan-out), event id (tracking) |
| Same quote card requested at once | Both render, one insert wins |
| Milestone event retried | `ON CONFLICT DO NOTHING` plus "notify only if inserted" |

## Slowness controls
- Statement timeout on every query, pool size limits, request timeouts (5 seconds on the API).
- Provider and Razorpay calls have timeouts and concurrency limits.
- Scheduler backpressure when the send queue is deep.
- A poison message goes to the dead-letter queue after 5 receives and does not block others.
- Use database time for scheduling, and run NTP on the VM, so clock drift cannot misfire slots.

## Alerts to create
- Dead-letter queue depth above 0
- Oldest message age on the send, tracking and webhook queues
- `unknown_outcome` deliveries above 0
- Bounce rate and complaint rate per publication
- Cache hit ratio below 90%
- Replica lag
- Disk usage above 80% and container memory near limit
- Webhook processing failures
- Reconciliation job found drift (it repaired something)
- Tracking events dropped above 0

## Tests (chaos suite)
Kill the sender mid-send, replay and reorder webhooks, stop Redis, stop ClickHouse during a click storm, throttle the provider, stop the queue during a publish, pause the replica. Each maps to a row above.