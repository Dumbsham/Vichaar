<div align="center">

# Vichaar

**A newsletter platform for Indian writers, built with reliability in mind.**

[![CI](https://github.com/Dumbsham/Vichaar/actions/workflows/ci.yml/badge.svg)](https://github.com/Dumbsham/Vichaar/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)

[System design](docs/design.md) · [Implementation plan](docs/MasterPlan.md) · [Flows](docs/flows.md) · [Decision records](docs/adr/)

</div>

> **Current status:** Phase 2 is implemented locally: double opt-in subscriptions and the outbox-to-email delivery pipeline. The reader-facing Next.js app, billing, tracking ingestion, and deployment containers are later phases. The scale numbers below remain unmeasured design goals.

## What works today

- **Accounts:** Writers can sign up, log in, and log out. Passwords use Argon2id; session tokens are hashed in PostgreSQL and sent in HttpOnly cookies. Auth requests use a Redis rate limiter with a smaller local fallback.
- **Publications:** An authenticated writer can create, list, read, and update their publications. Tenant checks prevent access to another writer's publication.
- **Posts:** Writers can create drafts, list and read them, and autosave with a version check that rejects stale edits. Posts carry a language tag and can be marked free or paid.
- **Publishing:** The API sanitizes post HTML and commits the post, tracked links, writing streak, and a `PostPublished` outbox event in one transaction. Repeating the publish request does not create a second event.
- **Public previews:** A published post can be read by subdomain and slug. A paid post's full body is not returned by this public endpoint.
- **Project foundation:** The pnpm workspace, strict TypeScript, module-boundary lint rule, PostgreSQL migrations, health checks, local Compose dependencies, and CI are in place.
- **Subscriptions:** Readers request a confirmation email without exposing whether an address is already subscribed. Signed links confirm once; signed unsubscribe links add a suppression and stop pending sends. Readers can change slot and timezone while deliveries remain pending. `/subscribe-demo` is a plain HTML verification page.
- **Delivery:** Five separately run workers relay outbox events through ElasticMQ, fan out active subscribers in pages, claim due rows fairly with a daily publication cap, send through a stub, Mailpit SMTP, or SES sandbox provider, and sweep stale rows. A sender claims a row before calling the provider; ambiguous outcomes are flagged and never automatically retried. Monthly partitions and a default partition hold the delivery ledger.

Scheduled posts are released by the scheduler when due. There is no Next.js frontend, checkout, paywall, or analytics endpoint yet. Email links are sent directly; open and click tracking are Phase 5 work.

## Run the current API locally

**Requirements:** Node.js 22.12 or newer, pnpm 9, and Docker with Compose.

```bash
git clone https://github.com/Dumbsham/Vichaar.git
cd Vichaar
pnpm install
pnpm stack:up
pnpm db:migrate
pnpm dev
```

The API listens on `http://localhost:4000`. `pnpm dev` also starts the five worker roles as separate processes. Check `GET /healthz` for process health and `GET /readyz` for PostgreSQL connectivity. `pnpm db:seed` currently checks the baseline migration record; it does not create sample writers or posts.

The workers need local SQS credentials exported, such as `AWS_ACCESS_KEY_ID=test` and `AWS_SECRET_ACCESS_KEY=test`. [`.env.example`](.env.example) documents the remaining configuration. Scripts do not automatically load `.env`; export variables or provide them through your process manager. The local defaults target Compose. `TRUST_PROXY` should be set only to a known reverse proxy address or CIDR when deploying behind one.

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
| `GET`          | `/healthz`, `/readyz`                         | Liveness and database readiness                    |
| `POST`         | `/public/:subdomain/subscribe`                | Request double opt-in; always returns `202`        |
| `POST`         | `/subscriptions/confirm`                      | Confirm a signed link                              |
| `GET`, `POST`  | `/unsubscribe/:token`                         | Show and submit unsubscribe                        |
| `GET`, `POST`  | `/subscriptions/preferences/:token`           | Change a reader's slot and timezone                |
| `GET`, `POST`  | `/subscribe-demo`                             | Plain HTML subscribe/confirmation page             |

For request shapes, see the [shared Zod schemas](packages/shared/src/schemas/) and the [Phase 1B plan](docs/MasterPlan.md#phase-1b-domain-foundation-auth-tenant-scoping-publications--posts).

## Tests and checks

With the local stack running:

```bash
pnpm lint
REDIS_TEST_URL=redis://localhost:6379 pnpm test
```

`pnpm lint` runs ESLint and TypeScript checks. `pnpm test` runs Vitest, including API and pipeline tests against real PostgreSQL, Redis, and ElasticMQ with a stub email provider. The kill-sender chaos test uses an isolated local ElasticMQ queue. Setting `REDIS_TEST_URL` also runs the shared Redis rate-limit test. Run `pnpm db:migrate` first. Test counts can change as the project grows.

## Design direction

Vichaar is a modular monolith with separate delivery workers. PostgreSQL holds durable state; Redis is for rate limits and public preview caching. Domain changes are recorded in a transactional outbox and relayed through an SQS-compatible queue. The implemented delivery flow is outbox relay → subscriber fan-out → slot scheduler → sender, with an atomic delivery claim before an email is sent. Ambiguous send outcomes are flagged rather than automatically retried. Open and click events remain planned for batched ClickHouse ingestion instead of per-event PostgreSQL writes.

The design targets include 500,000 recipients for one send, 1,000 emails per second, cache-first post reads, and operation on a 2 vCPU / 12 GB demo machine. These are **unverified targets**. The calculations, resource budget, and tradeoffs are in [docs/design.md](docs/design.md); measured benchmarks will be added only after real runs.

The local [Compose file](infra/compose/docker-compose.yml) defines PostgreSQL, a second PostgreSQL container, Redis, ElasticMQ, ClickHouse, and Mailpit. The API and workers run as local Node processes during this phase. The second PostgreSQL container is a working streaming read replica in the local Compose stack. Caddy, API/web/worker containers, an OpenTelemetry collector, and the Terraform production blueprint remain future work. No live demo or production deployment is claimed here.

## Repository map

```text
apps/api/          Express API: auth, publications, posts, health
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
- [ ] Phase 4: Razorpay subscriptions, webhooks, and paywall
- [ ] Phase 5: open/click tracking and ClickHouse analytics pipeline
- [ ] Later phases: quote cards, milestones, observability, load and chaos measurements, Next.js frontend, deployment blueprint

The detailed sequence and scope are in [docs/MasterPlan.md](docs/MasterPlan.md). Custom domains and CSV subscriber import are outside the v1 scope.

## Project documents

- [System design](docs/design.md) — requirements, capacity assumptions, data model, resource budget
- [Flows](docs/flows.md) — publish, delivery, billing, tracking, and other planned paths
- [Threat model](docs/threat-model.md) and [failure analysis](docs/failure-analysis.md)
- [Architecture decision records](docs/adr/)
- [Agent and contribution rules](AGENTS.md)
