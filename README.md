<div align="center">

# Vichaar

**A newsletter platform for Indian writers, built with reliability in mind.**

[![CI](https://github.com/Dumbsham/Vichaar/actions/workflows/ci.yml/badge.svg)](https://github.com/Dumbsham/Vichaar/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)

[System design](docs/design.md) · [Implementation plan](docs/MasterPlan.md) · [Flows](docs/flows.md) · [Decision records](docs/adr/)

</div>

> **Current status:** Phase 1B is implemented as an Express API. The reader-facing web app and email delivery pipeline are not implemented yet. The architecture and scale numbers below are design goals, not measured results.

## What works today

- **Accounts:** Writers can sign up, log in, and log out. Passwords use Argon2id; session tokens are hashed in PostgreSQL and sent in HttpOnly cookies. Auth requests use a Redis rate limiter with a smaller local fallback.
- **Publications:** An authenticated writer can create, list, read, and update their publications. Tenant checks prevent access to another writer's publication.
- **Posts:** Writers can create drafts, list and read them, and autosave with a version check that rejects stale edits. Posts carry a language tag and can be marked free or paid.
- **Publishing:** The API sanitizes post HTML and commits the post, tracked links, writing streak, and a `PostPublished` outbox event in one transaction. Repeating the publish request does not create a second event.
- **Public previews:** A published post can be read by subdomain and slug. A paid post's full body is not returned by this public endpoint.
- **Project foundation:** The pnpm workspace, strict TypeScript, module-boundary lint rule, PostgreSQL migrations, health checks, local Compose dependencies, and CI are in place.

A future publication time can be stored on a post, but scheduled posts are not automatically released yet. Outbox events are stored but **no worker relays them or sends email**. There is no Next.js frontend, checkout, paywall, or analytics endpoint yet.

## Run the current API locally

**Requirements:** Node.js 20, pnpm 9, and Docker with Compose.

```bash
git clone https://github.com/Dumbsham/Vichaar.git
cd Vichaar
pnpm install
pnpm stack:up
pnpm db:migrate
pnpm --filter @vichaar/api dev
```

The API listens on `http://localhost:4000`. Check `GET /healthz` for process health and `GET /readyz` for PostgreSQL connectivity. `pnpm db:seed` currently checks the baseline migration record; it does not create sample writers or posts.

[`.env.example`](.env.example) documents configuration. The current scripts do not automatically load `.env`; export variables or provide them through your process manager when changing the defaults. The local PostgreSQL and Redis defaults match the Compose ports. `TRUST_PROXY` should be set only to a known reverse proxy address or CIDR when deploying behind one.

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

For request shapes, see the [shared Zod schemas](packages/shared/src/schemas/) and the [Phase 1B plan](docs/MasterPlan.md#phase-1b-domain-foundation-auth-tenant-scoping-publications--posts).

## Tests and checks

With the local stack running:

```bash
pnpm lint
REDIS_TEST_URL=redis://localhost:6379 pnpm test
```

`pnpm lint` runs ESLint and TypeScript checks. `pnpm test` runs Vitest, including API tests against real PostgreSQL; setting `REDIS_TEST_URL` also runs the shared Redis rate-limit test. CI starts PostgreSQL and Redis, applies migrations, then runs these checks along with dependency and secret scans. Test counts can change as the project grows.

## Design direction

Vichaar is planned as a modular monolith with separate workers. PostgreSQL holds durable state; Redis is for cache and rate limits. Domain changes are recorded in a transactional outbox so a future relay can publish them through an SQS-compatible queue. The proposed delivery flow is outbox relay → subscriber fan-out → slot scheduler → sender, with an atomic delivery claim before an email is sent. Ambiguous send outcomes would be flagged rather than automatically retried. Open and click events are planned for batched ClickHouse ingestion instead of per-event PostgreSQL writes.

The design targets include 500,000 recipients for one send, 1,000 emails per second, cache-first post reads, and operation on a 2 vCPU / 12 GB demo machine. These are **unverified targets**. The calculations, resource budget, and tradeoffs are in [docs/design.md](docs/design.md); measured benchmarks will be added only after real runs.

The local [Compose file](infra/compose/docker-compose.yml) defines PostgreSQL, a second PostgreSQL container, Redis, ElasticMQ, ClickHouse, and Mailpit. The second PostgreSQL container is **not configured as a streaming replica** yet. Caddy, API/web/worker containers, observability services, and the Terraform production blueprint described in the design remain future work. No live demo or production deployment is claimed here.

## Repository map

```text
apps/api/          Express API: auth, publications, posts, health
packages/db/       PostgreSQL client, Drizzle schemas, SQL migrations
packages/shared/   Zod contracts, errors, clock, signed-token helpers
infra/compose/     Local dependency containers
fixtures/          Boundary-rule test fixture
tests/             Workspace-level tests
docs/              Design, flows, threat model, failure analysis, ADRs
```

## Roadmap

- [x] Phase 1A: workspace, local infrastructure, baseline migration, health API, CI
- [x] Phase 1B: accounts, tenant-scoped publications and posts, draft versioning, safe previews, publish outbox
- [ ] Phase 2: double opt-in subscriptions and the email delivery workers
- [ ] Phase 3: CDN/Redis read path and working read replica
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
