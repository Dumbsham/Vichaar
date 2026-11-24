# Threat model

Status: draft v1. Scope: the Vichaar API, workers, tracking endpoints and webhooks.

## What we protect
| Asset | Why it matters |
|---|---|
| Subscriber email addresses | Personal data. A leak harms readers and writers (and India's DPDP Act applies). |
| Paid post bodies | The product writers charge for. |
| Payment state (entitlements) | Free access or locked-out payers. |
| Sender reputation | One abusive writer can get every writer's mail marked as spam. |
| Writer accounts | Takeover means sending to the writer's whole list. |

## Who can reach us
Browsers (anonymous, readers, writers), Razorpay and Amazon SNS (webhooks), email recipients (links in emails), the open internet (scanners and bots).

## Threats and mitigations

| # | Threat | Mitigation | Proof (test) |
|---|---|---|---|
| 1 | **Cross-tenant access** (reading or editing another writer's data by changing an id) | Every repository function takes `publicationId` as a required argument. Another tenant's resource returns 404. Membership check in middleware. | Per-module test: user A requests user B's resource and gets 404 |
| 2 | **Forged webhooks** (fake "payment succeeded") | Verify the signature over the **raw body** with constant-time comparison before anything else. SNS signature check for SES. Secrets only from environment variables. Replays are harmless because of the unique event id and `last_event_at`. | Wrong signature gets 401; replay changes nothing |
| 3 | **Stored XSS through post HTML** | Allow-list sanitizer on the server at publish time (no scripts, no event handlers, no `javascript:` URLs), strict `Content-Security-Policy`, no inline scripts, links get `rel="noopener noreferrer nofollow"`. Emails get the same sanitized HTML. | Payload corpus test: script tags, `onerror`, `javascript:` and SVG tricks are stripped |
| 4 | **Open redirect** via tracking links | Click tokens are signed, and the redirect only goes to a URL stored in `tracked_links`. Only `http` and `https` schemes are accepted at publish time. | Tampered token returns no redirect |
| 5 | **Account takeover** | argon2 password hashing, login rate limits, identical error for wrong email and wrong password, session id rotated on login, `HttpOnly` `Secure` `SameSite` cookies, `Origin` check on state-changing requests, single-use hashed reset tokens with short expiry | Login throttling test; reset token cannot be reused |
| 6 | **Subscriber enumeration** (is this email on a list?) | Subscribe always returns 202. Login and forgot-password give identical responses. | Same response for known and unknown address |
| 7 | **Subscription bombing** (signing up a victim to many lists) | Double opt-in, limit confirmation emails per address per day, per-IP limits, optional Cloudflare Turnstile | Third confirmation in a day is not sent |
| 8 | **Paid content leak** | Separate authenticated endpoint, `private, no-store`, never in shared cache. Quote cards of paid posts only match the preview unless entitled (otherwise 200 versus 422 is an oracle). | Anonymous request for full body fails; cache never contains `html_full` |
| 8a | **Paid body in a public HTML artifact** | The page worker fetches Next.js without cookies and stores only the anonymous response. A deployed proxy must bypass static/CDN serving for session-bearing readers and route them to Next.js. | Browser flow verifies the paid artifact has its preview and excludes the private ending |
| 9 | **Spam by writers** (reputation damage) | Daily send limit for new writers, complaint-rate threshold that pauses sending, suppression lists, `List-Unsubscribe` headers | Simulated complaints pause the publication |
| 10 | **Email header injection** (newlines in names or subjects) | Strip CR and LF from any value used in a header; templates escape content | Subject with newline is rejected or cleaned |
| 11 | **Malicious uploads** | Check file type by content, size cap, re-encode images, random file names, no SVG uploads | Disguised file rejected |
| 12 | **SSRF** (server fetching attacker URLs) | Rule: the server never fetches user-supplied URLs | Code review rule in `AGENTS.md` |
| 13 | **Leaked secrets and bad dependencies** | Secrets only from environment, secret scanning and dependency audit in CI, lockfile committed, pinned base images | CI fails on findings |
| 14 | **PII in logs** | Log ids, never email addresses or tokens; redaction in the logger | Test that log output has no `@` addresses |
| 15 | **Admin abuse** | `is_admin` checked on a separate route prefix, rate limited, actions logged | Non-admin gets 403 |

## Rate limits (starting values, tune with metrics)

| Endpoint | Limit |
|---|---|
| Login | 5 per minute per IP and per account |
| Signup | 10 per hour per IP |
| Forgot password | 3 per hour per address |
| Subscribe | 5 per minute per IP; 3 confirmation emails per day per address |
| Quote card | 10 per minute per IP |
| Public cached reads | Handled by the CDN |
| Tracking | High per-IP ceiling, never blocking a human click |
| Webhooks | Signature check first; no business rate limit |

Implemented as Redis token buckets. If Redis is down, a smaller in-memory limiter takes over. Mutating routes have a request body size limit.

## Defense in depth (planned, not v1)
- Postgres Row Level Security with the publication id set per transaction, so a missed filter still cannot leak rows.
- Audit log of admin and writer-sensitive actions.
- Data deletion and export for subscribers (DPDP).

## Out of scope for v1
DDoS beyond what Cloudflare absorbs, insider threats, and compromised provider accounts.
