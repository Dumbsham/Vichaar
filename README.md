<div align="center">

<pre>
██      ██  ██████████    ████████  ██      ██    ██████      ██████    ████████  
██      ██      ██      ██          ██      ██  ██      ██  ██      ██  ██      ██
██      ██      ██      ██          ██████████  ██████████  ██████████  ████████  
  ██  ██        ██      ██          ██      ██  ██      ██  ██      ██  ██    ██  
    ██      ██████████    ████████  ██      ██  ██      ██  ██      ██  ██      ██
</pre>

**A newsletter platform for Indian writers, built with reliability in mind.**

[![CI](https://github.com/Dumbsham/Vichaar/actions/workflows/ci.yml/badge.svg)](https://github.com/Dumbsham/Vichaar/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)

[System design](docs/design.md) · [Implementation plan](docs/MasterPlan.md) · [Flows](docs/flows.md) · [Decision records](docs/adr/)

</div>

> **Current status:** Phases 1–7 and frontend F0–F3 are implemented locally. Next.js has public reading, subscription, account, and writer workspace pages. Writing/editor and quote-card screens remain in F4/F5. The planned 2 vCPU demo capacity and production email throughput remain unverified. Razorpay requests need your own test keys; automated tests use a stub provider. Deployment containers remain a later phase.

## What works today

- **Accounts:** Writers can sign up, log in, and log out. Passwords use Argon2id; session tokens are hashed in PostgreSQL and sent in HttpOnly cookies. Auth requests use a Redis rate limiter with a smaller local fallback.
- **Publications:** An authenticated writer can create, list, read, and update their publications. Tenant checks prevent access to another writer's publication.
- **Posts:** Writers can create drafts, list and read them, and autosave with a version check that rejects stale edits. Posts carry a language tag and can be marked free or paid.
- **Publishing:** The API sanitizes post HTML and commits the post, tracked links, writing streak, and a `PostPublished` outbox event in one transaction. Repeating the publish request does not create a second event.
- **Public previews:** A published post can be read by subdomain and slug. A paid post's full body is not returned by this public endpoint.
- **Public web reading:** Next.js serves publication pages and free post bodies at `/p/:subdomain` and `/p/:subdomain/:slug`. Paid posts show only their safe preview. Public lists use cursor pagination and exclude drafts and other publications. `/design-proof` shows clearly labelled sample typography in English, Hindi, and Tamil.
- **Reader web flows:** Next.js provides signup/login/logout, confirmation, delivery preferences, unsubscribe, subscription status, and paid reading. The browser opens Razorpay test checkout only after the API creates it; backend entitlement remains authoritative.
- **Writer workspace:** `/studio` lets an owner create and select publications. The overview, readers, analytics, and settings screens use owner-scoped API data. The active-reader API is cursor-paginated and returns at most 50 readers per page.
- **Project foundation:** The pnpm workspace, strict TypeScript, module-boundary lint rule, PostgreSQL migrations, health checks, local Compose dependencies, and CI are in place.
- **Subscriptions:** Readers request a confirmation email without exposing whether an address is already subscribed. Signed links confirm once; signed unsubscribe links add a suppression and stop pending sends. Readers can change slot and timezone while deliveries remain pending. New email links open the web pages; older API-host paths remain available.
- **Delivery:** Five delivery worker roles relay outbox events through ElasticMQ, fan out active subscribers in pages, claim due rows fairly with a daily publication cap, send through a stub, Mailpit SMTP, or SES sandbox provider, and sweep stale rows. A sender claims a row before calling the provider; ambiguous outcomes are flagged and never automatically retried. Monthly partitions and a default partition hold the delivery ledger.
- **Paid access:** Logged-in, confirmed newsletter readers can start a Razorpay test-mode subscription. Signed webhooks enter a durable inbox and the hooks queue; a worker applies them once and rejects stale events. Paid bodies require a database-backed entitlement with a 60-second Redis cache. A separate hourly worker reconciles missed payment events. Cancellation and subscription status endpoints are available.
- **Quote cards and milestones:** Readers can create a PNG from verified post text in English, Hindi, or Tamil. Paid posts allow preview text unless the reader is entitled. Cards are cached by a stable hash and removed after unpublish. Confirmation events create 10, 100, and 1,000 subscriber milestones once. Owners can read milestone history and their IST writing streak.

Scheduled posts are released by the scheduler when due. Email post-body and account-action links point to the web origin. Analytics statistics are available to publication owners.

## Run the API and frontend locally

**Requirements:** Node.js 22.12 or newer, pnpm 9, and Docker with Compose.

```bash
git clone https://github.com/Dumbsham/Vichaar.git
cd Vichaar
pnpm install
pnpm stack:up
pnpm db:migrate
pnpm dev
```

The web app listens on `http://localhost:3000`, and the API on `http://localhost:4000`. Open `/design-proof` to inspect the layout without data, or `/p/<subdomain>` after creating a publication and publishing a post through the API. `pnpm dev` creates the four local ElasticMQ queues before starting eight worker roles. Check API `GET /healthz` and `/readyz` for health. `pnpm db:seed` does not create sample writers or posts. The web server uses `API_ORIGIN` (default `http://127.0.0.1:4000`) for reads and its same-origin `/api/*` rewrite. Keep `CORS_ORIGIN` set to the browser's web origin for mutating requests.

The workers need local SQS credentials exported, such as `AWS_ACCESS_KEY_ID=test` and `AWS_SECRET_ACCESS_KEY=test`. [`.env.example`](.env.example) documents the remaining configuration. Scripts do not automatically load `.env`; export variables or provide them through your process manager. The local defaults target Compose. `TRUST_PROXY` should be set only to a known reverse proxy address or CIDR when deploying behind one.

Phase 5 starts a separate tracking listener at `http://localhost:4001` and an analytics worker. Set the same `TRACKING_HMAC_SECRET` (at least 32 characters) for both processes. The local Compose ClickHouse user and password are in `.env.example`; existing ClickHouse containers created with different credentials need matching `CLICKHOUSE_USER` and `CLICKHOUSE_PASSWORD`. Writer statistics are at `GET /publications/:pubId/stats`. Tracking metrics are at port 4001 `/metrics`, and analytics worker metrics use port 9107.

For Phase 6, `POST /public/:subdomain/posts/:slug/quote-cards` accepts `{ "quote": "text from the post" }` and returns a PNG URL. `GET /publications/:pubId/milestones` requires the owner's session. `QUOTE_CARD_DIR` defaults to `./data/quote-cards` relative to the repository root; the API and fanout worker use the same directory. No new API key is needed. The worker's email provider must already be configured to notify writers. The quote-card web UI is planned for F5.

### Razorpay test-mode setup

1. In the Razorpay dashboard, switch to **Test Mode** and create API keys. Export `RAZORPAY_KEY_ID` (`rzp_test_...`) and `RAZORPAY_KEY_SECRET` in the API and worker environments. The API refuses live-mode keys.
2. Create a **separate** webhook secret (at least 32 characters), export it as `RAZORPAY_WEBHOOK_SECRET` in the API environment, and configure the same secret for the test-mode webhook. Subscribe to subscription lifecycle events and point the webhook to `POST /webhooks/razorpay` on a reachable HTTPS URL. A local-only `localhost` URL cannot receive Razorpay's remote webhook.
3. A writer sets a monthly price in `/studio/:publicationId/settings`. A reader creates an account with their newsletter email, confirms that newsletter subscription, then opens checkout on the paid post. The API returns the Razorpay test key ID and subscription ID for the browser checkout. `GET /me/subscriptions?publicationId=:id` shows processing or active status. The browser payment callback never unlocks content; only a verified webhook or reconciliation does.

No real charge or live payment is supported. Automated webhook tests use signed synthetic events and a stub provider, so they run without Razorpay credentials. The account-email verification and remote-create crash gap in [ADR-012](docs/adr/012_billingWebhookInbox.md) must be closed before any live-payment launch.

### API routes available now

| Method         | Path                                          | Purpose                                            |
| -------------- | --------------------------------------------- | -------------------------------------------------- |
| `POST`         | `/auth/signup`, `/auth/login`, `/auth/logout` | Account and session actions                        |
| `POST`, `GET`  | `/publications`                               | Create or list the signed-in writer's publications |
| `GET`, `PATCH` | `/publications/:pubId`                        | Read or update an owned publication                |
| `POST`, `GET`  | `/publications/:pubId/posts`                  | Create or list drafts and posts                    |
| `GET`, `PATCH` | `/publications/:pubId/posts/:postId`          | Read or autosave an owned post                     |
| `POST`         | `/publications/:pubId/posts/:postId/publish`  | Publish or record a future schedule; returns `202` |
| `GET`          | `/public/:subdomain/posts/:slug`              | Read a published public preview                    |
| `GET`          | `/public/:subdomain`                          | Read public publication metadata                   |
| `GET`          | `/public/:subdomain/posts?cursor=&limit=`     | Read only published posts, with bounded pagination |
| `GET`          | `/publications/:pubId/stats`                  | Publication-scoped open and click rollups          |
| `GET`          | `/publications/:pubId/readers?cursor=&limit=` | Owner-only active readers, at most 50 per page     |
| `GET`          | `:4001/t/o/:token.gif`, `:4001/t/c/:token`    | Open pixel and signed click redirect               |
| `GET`          | `/healthz`, `/readyz`                         | Liveness and database readiness                    |
| `POST`         | `/public/:subdomain/subscribe`                | Request double opt-in; always returns `202`        |
| `POST`         | `/subscriptions/confirm`                      | Confirm a signed link                              |
| `GET`, `POST`  | `/unsubscribe/:token`                         | Show and submit unsubscribe                        |
| `GET`, `POST`  | `/subscriptions/preferences/:token`           | Change a reader's slot and timezone                |
| `GET`, `POST`  | `/subscribe-demo`                             | Plain HTML subscribe/confirmation page             |
| `POST`        | `/public/:subdomain/checkout`                 | Create a test-mode Razorpay subscription           |
| `POST`        | `/webhooks/razorpay`                          | Receive a signed payment event                     |
| `GET`         | `/me/subscriptions?publicationId=:id`         | Read paid subscription status for one publication  |
| `POST`        | `/me/subscriptions/:id/cancel`                | Cancel at period end; body has `publicationId`     |
| `GET`         | `/public/:subdomain/posts/:slug/full`         | Read a full post, with paid access checked         |
| `POST`        | `/publications/:pubId/posts/:postId/unpublish` | Unpublish and queue card cleanup                  |
| `POST`        | `/public/:subdomain/posts/:slug/quote-cards`  | Create a verified quote-card PNG                   |
| `GET`         | `/public/:subdomain/posts/:slug/quote-cards/:hash.png` | Retrieve a published post's card          |
| `GET`         | `/publications/:pubId/milestones`             | Read owned milestones and writing streak           |

For request shapes, see the [shared Zod schemas](packages/shared/src/schemas/) and the [Phase 1B plan](docs/MasterPlan.md#phase-1b-domain-foundation-auth-tenant-scoping-publications--posts).

## Tests and checks

With the local stack running:

```bash
pnpm lint
REDIS_TEST_URL=redis://localhost:6379 pnpm test
```

`pnpm lint` runs ESLint and TypeScript checks. `pnpm test` runs Vitest, including API, delivery, and chaos tests against real PostgreSQL, Redis, ElasticMQ and isolated Redis/ClickHouse containers with stub providers. The chaos tests need local Docker access. Setting `REDIS_TEST_URL` also runs the shared Redis rate-limit test. Run `pnpm db:migrate` first. `pnpm loadtest` runs the 500,000-recipient stub delivery and 1,000-recipient slot timing benchmarks against temporary local databases; allow several minutes. Test counts can change as the project grows.

## Design direction

Vichaar is a modular monolith with separate delivery workers. PostgreSQL holds durable state; Redis is for rate limits and public preview caching. Domain changes are recorded in a transactional outbox and relayed through an SQS-compatible queue. The implemented delivery flow is outbox relay → subscriber fan-out → slot scheduler → sender, with an atomic delivery claim before an email is sent. Ambiguous send outcomes are flagged rather than automatically retried. Open and click events are batched into ClickHouse without per-event PostgreSQL writes.

The design targets include 500,000 recipients for one send, 1,000 emails per second, cache-first post reads, and operation on a 2 vCPU / 12 GB demo machine. The local raw stub pipeline exceeded 1,000 emails/s, but the demo scheduler and provider limits remain below that target; the 2 vCPU deployment is unverified. The calculations, resource budget, and tradeoffs are in [docs/design.md](docs/design.md); recorded results from real runs are in [docs/benchmarks.md](docs/benchmarks.md).

The local [Compose file](infra/compose/docker-compose.yml) defines PostgreSQL, a second PostgreSQL container, Redis, ElasticMQ, ClickHouse, and Mailpit. The API and workers run as local Node processes during this phase. The second PostgreSQL container is a working streaming read replica in the local Compose stack. Caddy, API/web/worker containers, an OpenTelemetry collector, and the Terraform production blueprint remain future work. No live demo or production deployment is claimed here.

## Repository map

```text
apps/api/          Express API: auth, publications, posts, health
apps/web/          Next.js reading, reader account, and writer workspace
apps/workers/      Delivery workers and email providers
packages/db/       PostgreSQL client, Drizzle schemas, SQL migrations
packages/queue/    Typed SQS-compatible queues
packages/shared/   Zod contracts, errors, clock, signed-token helpers
infra/compose/     Local dependency containers
fixtures/          Boundary-rule test fixture
tests/             Workspace-level tests
docs/              Design, flows, threat model, failure analysis, ADRs
```

## Roadmap

- [x] Phase 1A: workspace, local infrastructure, baseline migration, health API, CI
- [x] Phase 1B: accounts, tenant-scoped publications and posts, draft versioning, safe previews, publish outbox
- [x] Phase 2: double opt-in subscriptions and the email delivery workers
- [x] Phase 3: CDN-compatible headers, Redis public-preview cache, and working read replica
- [x] Phase 4: Razorpay test-mode subscriptions, webhooks, and paywall
- [x] Phase 5: open/click tracking and ClickHouse analytics pipeline (local load result in `docs/benchmarks.md`)
- [x] Phase 6: language-aware quote cards, milestones, and IST writing streak verification
- [x] Phase 7: metrics, tracing, logging redaction, Redis and ClickHouse chaos, stub delivery and slot benchmarks
- [ ] Phase 8: Next.js frontend and deployment blueprint
  - [x] Frontend F0: foundation, editorial design proof, same-origin API rewrite
  - [x] Frontend F1: publication and post reading with public paginated API reads
  - [x] Frontend F2: reader account, subscription, and paid reading
  - [x] Frontend F3: writer overview, readers, analytics, and settings
  - [ ] Frontend F4–F5 and separate deployment blueprint

The detailed sequence and scope are in [docs/MasterPlan.md](docs/MasterPlan.md). Custom domains and CSV subscriber import are outside the v1 scope.

## Project documents

- [System design](docs/design.md) — requirements, capacity assumptions, data model, resource budget
- [Frontend phase plan](docs/frontend-phase-plan.md) — simple editorial design, screen sequence, API gaps, and release checks
- [Flows](docs/flows.md) — publish, delivery, billing, tracking, and other planned paths
- [Threat model](docs/threat-model.md) and [failure analysis](docs/failure-analysis.md)
- [Architecture decision records](docs/adr/)
- [Agent and contribution rules](AGENTS.md)
