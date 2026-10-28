# ADR-011: Confirmation outbox with signed reconstructible tokens

Status: Accepted
Date: 2026-10-28

## Context

A subscription request must return quickly, avoid address enumeration, and never activate consent without a link click. The request can commit while the email queue is down. Queue messages can repeat, and logging or storing a usable confirmation link in an outbox payload increases exposure.

## Options

1. Send SMTP within the HTTP request. A provider outage blocks requests and can leave subscription and email state inconsistent.
2. Put the raw confirmation token in a queue message. Retry is easy, but the durable queue contains a usable capability token.
3. Commit a pending subscription and an outbox event together, storing only a token hash. Reconstruct the signed token from the subscription ID and fixed expiry in the worker.

## Decision

Use option 3. The API always returns the same `202` response for known and unknown addresses of an existing publication. A transaction writes the pending row, its SHA-256 token hash and expiry, and `SubscriptionConfirmationRequested`. The outbox event contains IDs, expiry, and correlation ID, but no usable token. The worker conditionally stamps `confirmation_dispatched_at` before calling the provider; a repeated event therefore cannot send a duplicate confirmation. Confirmation conditionally changes `pending` to `active` and increments `subscriber_count` in the same transaction. A confirmation is limited to three requests per address per day. Unsubscribe adds a tenant-scoped suppression and skips pending/queued deliveries.

## Consequences

- The queue can be retried without storing a raw confirmation token.
- A worker crash or ambiguous provider outcome after the dispatch claim may leave no confirmation email. The reader can request another, up to the daily cap; the unknown outcome is visible through worker errors.
- A confirmed subscription and its counter cannot diverge under duplicate link clicks.
- Suppression prevents an unsubscribed address from reactivating through a fresh request.

## Revisit when

Confirmation delivery failures are frequent enough that the request cap or at-most-once dispatch harms legitimate signups. A provider with a reliable idempotency key could permit safe retries.
