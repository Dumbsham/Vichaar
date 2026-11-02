# ADR-012: Durable Razorpay webhook inbox and account-bound entitlements

Status: Accepted
Date: 2026-11-02

## Context

Razorpay can deliver duplicate or out-of-order events. Queue publication can fail after an event reaches the API. A browser callback cannot prove payment. An email newsletter subscription and a login account are different identities.

## Options

1. Update payment state in the HTTP webhook handler. This makes response time and retries depend on database work.
2. Trust the browser callback. This can grant access without a verified payment.
3. Store a verified event in PostgreSQL, enqueue its ID, and update state in a worker. Bind paid access to the account that started checkout.

## Decision

Use option 3. The API verifies HMAC-SHA256 over the raw body and stores the event ID under a unique constraint. The hook worker locks the inbox and paid rows, applies only newer timestamps, commits, then invalidates the Redis entitlement key. A failed queue send returns an HTTP error so Razorpay retries; the stored inbox record remains available. The hourly reconciliation worker fetches stale subscriptions directly from Razorpay. Only the account ID saved at checkout can read the paid body. Checkout requires an active, confirmed newsletter subscription with the same email. One open checkout per newsletter subscription is enforced by a partial unique index; expired rows remain as history.

## Consequences

- No browser response alone grants paid access. Duplicate events and delayed events cannot overwrite a newer payment state.
- Webhook processing is asynchronous; the reader polls their subscription status.
- The demo uses test-mode keys and a stub in tests. No live payment is sent.
- Checkout's remote create call happens while a database row is locked. A crash after remote creation but before commit can leave an orphaned Razorpay subscription; test-mode reconciliation is limited to subscriptions recorded locally. This must be resolved before live payments.
- Account signup currently does not verify ownership of its email address. Binding a pre-existing confirmed newsletter address to a new account therefore needs a verified account-email flow before live payments.

## Revisit when

Live billing is proposed, checkout traffic makes long row locks costly, or account-email verification is implemented.
