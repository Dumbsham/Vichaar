# ADR-001: Modular monolith with separate worker processes

Status: Accepted
Date: 2026-10-18

## Context
One builder, 8-10 weeks, a free 2 vCPU / 12 GB VM. Average load is tiny (about 1.65 emails/s, 3.5 page reads/s), with bursts of up to 1,000 emails/s. Failure isolation matters for sending and tracking, not for most CRUD.

## Options
1. **Microservices:** independent scaling and deploys, but network calls, distributed tracing, and many deployments for one person and one VM.
2. **Modular monolith plus worker processes:** one codebase and one database, with API and workers started as separate processes from the same code.
3. **Serverless functions:** cheap idle cost, but cold starts, connection limits to Postgres, and awkward long-running batches.

## Decision
Option 2. Modules (`auth`, `publications`, `posts`, `subscriptions`, `billing`, `delivery`, `analytics`) have strict boundaries enforced by a lint rule. Workers import the same services through the composition root.

## Consequences
- Simple deploys and debugging, real transactions across modules, cheap to run.
- Boundaries depend on tooling discipline, so CI must fail on violations.
- A module can be extracted later because it already talks through a public interface.

## Revisit when
A module needs independent scaling the VM cannot give, or more than one team works on the code.