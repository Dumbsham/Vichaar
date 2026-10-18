# ADR-002: Express 5 with explicit architecture

Status: Accepted
Date: 2026-10-18

## Context
TypeScript backend, modular monolith, workers that must reuse business logic. Load is low, so framework throughput is not a constraint.

## Options
1. NestJS (Fastify adapter): enforced modules, built-in dependency injection, more boilerplate and decorator magic.
2. Express 5 with hand-built structure.
3. Plain Fastify or Hono.

## Decision
Express 5. Structure is enforced by rules, not by the framework: route, service, repository layers; services have no Express types; one composition root wires dependencies; Zod validates every boundary; one public `index.ts` per module, checked by a boundary lint rule.

## Consequences
- Full control, low overhead, and workers call the same plain service functions.
- Consistency depends on lint rules, tests, and `AGENTS.md`.
- Express 5 forwards rejected promises from async handlers to the error middleware. Verify the installed version.

## Revisit when
Boundary violations keep appearing, or more developers join.