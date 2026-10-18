# AGENTS.md

Instructions for AI coding agents working on **Vichaar**, a newsletter platform for Indian writers, written in TypeScript with Express 5. It exists to demonstrate production-grade system design on a free-tier budget. Read this file fully before changing anything.

## Project goal

Build a correct, observable, scalable newsletter platform. Engineering quality matters more than feature count. A few hard problems (email fan-out, cache-first reads, event ingestion, paywall correctness, deliverability) must be done properly and proven with tests and measurements. Do not add features that were not requested. Scope is defined in the requirements document; items marked v2, stretch, or later are out of scope.

## Architecture summary

- **Modular monolith** (Express 5) plus separately run worker processes. Do not add services without an ADR.
- **PostgreSQL** is the source of truth (Drizzle ORM). **Redis** is cache and rate-limit state only, never durable.
- **Queue** is accessed through the SQS API: ElasticMQ in the demo, SQS in the production blueprint. Every consumer is **idempotent**.
- Domain events go to a **transactional outbox** in the same transaction as the state change, then are relayed to the queue.
- **ClickHouse** stores open and click events. Never write tracking events to PostgreSQL.
- **Email** goes through an `EmailProvider` interface with SES, SMTP and stub implementations, chosen by config.
- **Payments** are Razorpay (test mode). Amounts are integers in paise.
- **Next.js** frontend. Public post pages are rendered to static HTML on publish and served via CDN.
- India-first: IST is the default timezone, prices are in rupees, posts carry a language tag.
- Read `docs/design.md` and `docs/adr/` before changing architecture-level behavior. Read `docs/flows.md` before touching delivery, billing, tracking or quote cards, and `docs/threat-model.md` and `docs/failure-analysis.md` before touching auth, webhooks, caching or any external call.
- Email delivery is **at most once** (ADR-009): a sender must atomically claim a delivery row (`queued` to `sending`) before sending, and an unknown outcome is flagged `failed` with `unknown_outcome`, never resent automatically.

## Repository layout

```
apps/api/src/server.ts      app setup and middleware order
apps/api/src/container.ts   composition root, shared with workers
apps/api/src/modules/       one folder per domain module
apps/api/src/shared/        errors, logger, middleware, config
apps/workers/               outbox relay, fan-out, scheduler, sender, webhooks, analytics
apps/web/                   Next.js frontend
packages/db/                Drizzle schema and migrations
packages/queue/             typed queue producers and consumers
packages/shared/            Zod schemas and shared types
infra/compose/              demo deployment
infra/terraform/            production blueprint (plan only)
loadtests/  chaos/  docs/
```

## Commands

```bash
pnpm stack:up     # start local dependencies
pnpm db:migrate   # apply migrations
pnpm db:seed      # load demo data
pnpm dev          # run web, API, workers
pnpm test         # unit + integration tests
pnpm lint         # eslint, prettier, boundary rules, tsc --noEmit
pnpm loadtest     # k6 scenarios
pnpm chaos        # failure-injection suite
```

Run `pnpm lint` and `pnpm test` before calling any task done. If one fails, fix the cause. Never disable the check.

## Code structure rules (Express)

Express gives no structure, so these rules are the structure. Treat them as hard requirements.

**Layers**
- Flow is `route → service → repository → database`. Routes handle HTTP only. Services hold business logic. Repositories hold queries only.
- Services and repositories **never import Express types** (`Request`, `Response`, `NextFunction`). Workers call the same services.
- Routes stay thin: parse and validate input, call one service function, shape the response.

**Modules**
- Each module in `src/modules/<name>/` has `routes`, `service`, `repository`, `schemas` (Zod) files and one public `index.ts`.
- Other modules import **only** from a module's `index.ts`, never its internals or its tables. The boundary lint rule enforces this. Do not suppress it.
- Avoid circular dependencies between modules. If two modules need each other, extract the shared piece or emit a domain event.

**Dependency injection**
- Write factory functions: `createPostService({ postRepo, cache, queue })`. No module-level singletons holding state, no hidden `import` of a database client inside services.
- All wiring happens in `container.ts`. Providers (email, queue, payments, clock) are interfaces, so tests can pass stubs.
- Inject a clock instead of calling `new Date()` in business logic that depends on time (slots, streaks, scheduling).

**Express 5 usage**
- Async route handlers may throw. Rejections reach the central error middleware. Do not add try/catch only to forward errors.
- Middleware order: correlation ID → request logging (pino-http) → helmet → CORS → rate limiting → auth → tenant resolution → routes → error handler.
- Use one error middleware and typed errors (`NotFoundError`, `ForbiddenError`, `ValidationError`, `ConflictError`). Never leak stack traces or internals in responses.

## Coding standards

- TypeScript `strict` with `noUncheckedIndexedAccess`. No `any`, no `as` casts to silence errors; if unavoidable, comment why.
- Validate all external input (HTTP, queue messages, webhooks, env vars) with Zod at the boundary. Derive types from the schemas.
- Prefer small pure functions. Keep side effects at the edges.
- No floating promises (enforced by lint). Handle every rejection explicitly in workers.
- Money is integer paise. Timestamps are stored in UTC. Convert to a user's timezone only at the edge.
- Comments explain why, not what. No dead code, no commented-out code, no TODO without an issue reference.

## Non-negotiable rules

### Multi-tenancy and security
- Every query on tenant data **must** be scoped by `publicationId`. Repository functions take it as a required parameter. Add a test proving cross-tenant access is rejected.
- Enforce authorization on the backend. The frontend never decides access.
- Never log secrets, tokens, full request bodies, or raw email addresses.
- Sanitize all user-supplied post HTML with an allow-list sanitizer.
- Verify signatures on every webhook (Razorpay, email provider) before processing.
- Secrets come from environment variables only. Keep `.env.example` current.
- Subscriber addresses require consent. Never add an import or bulk-add path that skips confirmation.

### Reliability
- **Every queue consumer and webhook handler is idempotent.** Use an idempotency key protected by a unique constraint. A retry must never cause a duplicate email or duplicate state change.
- Handle out-of-order events (especially billing) by comparing event timestamps or versions.
- Every external call (email provider, Razorpay, Redis) has a timeout, bounded retries with exponential backoff and jitter, and a defined failure behavior.
- Failed jobs go to a dead-letter queue with enough context to replay them.
- The paywall **fails closed**, but on cache miss or Redis failure it checks the database before denying, so paying readers are not locked out by an infrastructure fault.
- A reader clicking a tracked link or loading a pixel must never be blocked by analytics failures. Respond first, enqueue asynchronously.
- Billing state is repaired by a reconciliation job, not only by webhooks.

### Performance and resource limits
- Target environment is **2 vCPU and 12 GB RAM** running every service. Respect the container limits in `docs/design.md`. Do not raise a limit without updating the budget.
- Cap worker concurrency and connection pool sizes. Keep the total under Postgres `max_connections`.
- No N+1 queries. Check the query plan for any new query on a large table, and add indexes through a migration.
- Batch send-state writes (roughly 100 rows per statement). Never write one row per email in a loop.
- No per-event writes to PostgreSQL for tracking. Use the event pipeline and batch inserts.
- Reads hit CDN or cache first. Invalidate narrowly, never globally. Paid post bodies are never placed in shared cache.
- Never load unbounded result sets. Use cursor pagination.

### Database
- Schema changes go through Drizzle migrations only, and must be backward compatible with the previous app version (expand, then contract).
- Never edit a merged migration. Add a new one.
- Partition high-volume tables (delivery log) by month.

### Cost and environments
- Do not add paid cloud resources or services. The demo runs on free tiers.
- Never run `terraform apply` or create cloud resources. Terraform is for `plan` only unless the owner says otherwise.
- Never send real email from non-production environments. Use Mailpit locally and the stub provider in tests and load tests.
- Real email is only sent through SES sandbox to verified demo addresses.

## Testing requirements

- New behavior needs tests. A bug fix needs a regression test that fails before the fix.
- Use Vitest, with supertest for routes. Integration tests run against real Postgres, Redis and ElasticMQ via Docker. Do not mock the database.
- Keep a small set of Playwright end-to-end tests for critical flows (subscribe, publish, receive, paywall, unsubscribe).
- These areas must always have tests:
  - Tenant isolation
  - Idempotent send and duplicate suppression
  - Slot scheduling across timezones, including a changed timezone
  - Webhook replay, reordering, and reconciliation
  - Paywall allow and deny decisions, including Redis outage
  - Unsubscribe and suppression-list behavior
  - Milestones fire exactly once
  - Quote card only accepts text that exists in the post
- Tests must be deterministic. No arbitrary sleeps; use explicit waits and an injected clock.

## Observability

- Structured JSON logs (pino) with a correlation ID that travels from request through queue to worker.
- Every worker and critical path exposes metrics: throughput, latency, error rate, queue depth, retry count, CPU-milliseconds per email.
- Add OpenTelemetry spans around external calls and queue handling.
- When you add a feature, add the metric or alert that would reveal it is broken.

## Documentation requirements

- Any architecture-affecting decision gets a new ADR in `docs/adr/` (context, options, decision, consequences, revisit trigger).
- Update `docs/design.md` when data models, flows, capacity assumptions, or the resource budget change.
- Never invent benchmark numbers. Record only results from real runs in `docs/benchmarks.md`, with the command, hardware, provider (stub or real), and date.
- State clearly in docs whether something runs in the demo deployment or only in the Terraform blueprint.
- Tick the README roadmap when a milestone is finished.

## Workflow

1. Read the relevant module, its tests, and any related ADR before editing.
2. For non-trivial work, state a short plan first, then implement in small reviewable steps.
3. Keep diffs focused. Do not refactor unrelated code in the same change.
4. Run `pnpm lint` and `pnpm test`, and report the results honestly, including failures.
5. Use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

## Do not

- Add a dependency without a clear need. Prefer the standard library and what is already installed, and say why a new package is required.
- Weaken or bypass auth, validation, rate limiting, boundary lint rules, or tests to make something pass.
- Introduce new services, datastores, or frameworks without an ADR.
- Put business logic in route handlers, or import Express types into services.
- Store durable state in Redis or process memory.
- Claim something works unless you ran it. If you could not verify, say so.

## When unsure

Ask a clarifying question instead of guessing, especially for anything involving tenant isolation, money, consent, or email delivery. Prefer the simpler design and record the tradeoff.