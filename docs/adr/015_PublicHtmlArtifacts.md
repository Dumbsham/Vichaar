# ADR-015: Separate public HTML artifact worker

Status: Accepted for local implementation; CDN serving remains a deployment gate
Date: 2026-11-25

## Context

ADR-007 calls for public HTML at publish time. Next.js currently renders publication and post routes on request. A paid reader's full body is fetched with a session cookie and must never enter a shared artifact or CDN cache. Generating pages in the email fan-out consumer would delay sends whenever the web renderer or CDN is unavailable.

## Options

1. Generate HTML in the publish request. This makes publishing depend on Next.js and can lose work after the transaction commits.
2. Generate in the existing fan-out consumer. Outbox replay is durable, but web or CDN failure would hold email delivery.
3. Relay post events to a separate SQS-compatible page queue and consumer. This adds one bounded worker and queue, while leaving delivery independent.

## Decision

Use option 3. The outbox relay sends `PostPublished` and `PostUnpublished` to both EventQ and PagesQ before marking the outbox row published. If either send fails, replay may duplicate a message; both consumers are idempotent. The page worker re-reads the publication-scoped post status, fetches the **anonymous** Next.js publication and post HTML without cookies, atomically writes `p/<subdomain>/index.html` and `p/<subdomain>/<slug>/index.html` under `PUBLIC_HTML_DIR`, and removes the post artifact when it is no longer published. A stale publish event cannot restore an unpublished post because the worker checks current database status. It purges only those two URLs through Cloudflare's [single-file purge API](https://developers.cloudflare.com/api/resources/cache/methods/purge/) when credentials are configured. Failed fetches and purges leave the message for bounded queue retry and then the dead-letter queue.

The deployment reverse proxy must serve the artifact for anonymous requests and bypass static/CDN caching when the `vichaar_session` cookie is present, sending those requests to Next.js for paid entitlement. It must serve `/_next` assets and `/api` through Next.js and redirect trailing-slash variants to one canonical URL. Until that routing and a real purge/MISS check are deployed, local artifacts are **not** the live public origin and no CDN or static-serving claim is made.

## Consequences

- Email delivery does not wait for Next.js rendering or Cloudflare purge.
- Artifact generation and purging can replay safely. PagesQ depth, worker errors, and its DLQ expose failures.
- A published post can remain stale at the edge until the page worker succeeds; the CDN's short TTL bounds the delay. Unpublish must purge rather than only revalidate because removed content must not remain served.
- Paid full HTML is never fetched for an artifact. Local browser tests assert that a paid artifact contains the preview and excludes the private ending.
- The page worker adds a process and up to three PostgreSQL connections. The resource and connection budget are updated in `design.md`.

## Revisit when

The deployment cannot safely bypass static content for session-bearing requests, or publish-to-artifact/purge lag exceeds the accepted public-cache lifetime.
