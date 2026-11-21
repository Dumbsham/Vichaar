# Vichaar frontend: phased implementation plan

Status: planned · 2026-11-22

This is the **web app track of Phase 8**. Build a small, complete Next.js frontend for reading, subscribing, paying in Razorpay test mode, and writing. Each phase should leave a usable slice of the product and pass its own checks before the next one begins. The original [MasterPlan](MasterPlan.md) also includes a deployment blueprint, backups, and infrastructure work in Phase 8; those are separate from this frontend plan.

There is no `apps/web` today. The Express API remains the authority for authentication, tenant access, consent, payment state, HTML sanitization, and delivery. A few read endpoints needed by the UI are missing; they are listed below rather than assumed to exist.

## The product we are making

Vichaar should feel like an independent publication and a calm writing desk. A reader should see the writing first. A writer should find the next action without learning a complicated dashboard. The interface can be visually distinctive through type, spacing, rules, and honest copy; it does not need a large component library or decorative effects.

### Visual direction

| Element | Direction |
|---|---|
| Page surface | Warm paper `#F7F5F0`, with white only for inputs and editor surfaces. |
| Text | Ink `#24211D`; quieter text `#625D56`; thin dividers `#D9D2C8`. |
| Accent | Deep brick `#8B3D35` for links and primary actions. A restrained gold may mark a section or date, but never carry essential text. Verify contrast in implementation. |
| Type | Readable locally bundled Noto Sans for body and Indian scripts. Try a restrained serif for English display headings; test actual Hindi and Tamil headings before choosing fallbacks. Avoid synthetic script styles. |
| Width | Reading column near 680 px; writer workspace near 1120 px. Body text roughly 65–75 characters per line, with generous line height. |
| Shape | Mostly flat surfaces, thin rules, a few intentional corners. A publication masthead, date stamps, and quiet section labels provide character. |
| Motion | Small 120–180 ms state changes for hover, focus, menus, and save feedback. Respect reduced-motion settings. No scroll-driven animation. |

**Reader page:** masthead, one clear description, a subscription action, then a chronological list of writing. Use title, language, date, and a short real excerpt. A paid post shows its real preview followed by a clear access explanation. Avoid a card grid for every post.

**Writer page:** compact publication switcher, clear left navigation on wide screens, simple top navigation on narrow screens, a current status line, and real counts. The editor gets most of the space. The dashboard should feel like a workbench, not a control room.

**Patterns to avoid:** full-screen gradient heroes, glass panels, identical rounded cards for every item, made-up testimonials or counts, decorative charts without data, stock photos of people writing, persistent toast spam, and copy such as “unlock your creative journey.” Use carefully written empty states: “No posts yet. Start with a draft.” or “Your first letter will appear here after you publish.”

Use a small set of hand-built components: `Button`, `TextField`, `Select`, `InlineNotice`, `Dialog`, `PublicationHeader`, `PostListItem`, and `StatusLabel`. Add a component only when it has more than one real use. Tailwind can hold tokens and layout rules; avoid importing a full dashboard template. Tiptap is justified for the rich-text editor specified in the [MasterPlan](MasterPlan.md), and should be loaded only on the editor route.

### Responsive and accessibility rules

- Review the actual pages at 360, 768, and 1440 px, including long titles and Hindi/Tamil copy. The reading column should remain readable at 320 px without horizontal scrolling.
- Use semantic headings, labels, visible focus, keyboard-operable menus and dialogs, meaningful link text, and a logical tab order. Target WCAG 2.2 AA for shipped screens.
- Keep forms usable without animation. Show errors next to the field and in a short summary when needed. Preserve user input after a failed request.
- Use native controls where they work well. A slot selector is three clear choices, not a custom carousel. A date/time input must show the selected timezone explicitly.
- Do not hide important state in color alone. “Saved,” “Saving,” “Could not save,” “Scheduled,” and “Published” need words.

## Route map

The routes below are frontend pages. They are distinct from Express API paths.

| Frontend route | Purpose |
|---|---|
| `/p/[subdomain]` | Publication home and published post list. |
| `/p/[subdomain]/[slug]` | Free post or paid preview, with an authenticated full-body request only when appropriate. |
| `/signup`, `/login` | Reader or writer account entry. Same account can do both. |
| `/confirm?token=…`, `/unsubscribe/[token]`, `/preferences/[token]` | Email-link flows with clear success and already-used states. |
| `/account/subscriptions` | Reader paid subscription status and cancellation. |
| `/studio` | Writer publication list, create publication, and entry point. |
| `/studio/[publicationId]` | Overview with genuine counts, milestones, and next actions. |
| `/studio/[publicationId]/posts` | Draft and published post list. |
| `/studio/[publicationId]/posts/[postId]` | Editor, autosave, schedule, publish, and unpublish. |
| `/studio/[publicationId]/readers` | Bounded subscriber list, only after the owner-only API endpoint exists. |
| `/studio/[publicationId]/analytics` | Existing opens/clicks by post and day, shown as a small chart or table. |
| `/studio/[publicationId]/settings` | Publication name, description, language, and monthly price. |

Before moving email links to the web origin, support compatibility paths for existing messages: `/public/:subdomain/posts/:slug`, `/subscribe-demo?token=…`, `/unsubscribe/:token`, and `/subscriptions/preferences/:token`. They can render or redirect to the corresponding page without exposing the token to third-party scripts. Keep the API-host links working until the new web paths are verified. Only then change `PUBLIC_BASE_URL` and the email templates, with a regression test for every link.

## API contract audit before implementation

| UI need | Current state | Smallest required work |
|---|---|---|
| Account signup, login, logout | Existing `/auth/*` endpoints with an HttpOnly session cookie. | Verify cookie and `Origin` behavior through the web origin; do not make a second auth system. |
| Writer publications and posts | Owner-only list/create/read/update/publish routes exist. | Reuse shared schemas and preserve version conflicts in the editor UI. |
| One public post and paid full body | Public preview and separate authenticated `/full` exist. | Render only API-sanitized preview HTML publicly. Full body is private and never enters shared caching. |
| Publication home | Public publication metadata and paginated **published** post list are not exposed. | Add narrow public read routes, scoped by `publicationId`, with cursor pagination, safe cache headers, and tests. Never reuse the owner-only draft list. |
| Subscribe, confirm, unsubscribe, preferences | API actions exist; old HTML pages are temporary. | Build the web forms and compatibility links; keep the API's generic subscribe response. |
| Razorpay checkout and reader subscription status | Test-mode checkout, status list, cancel, webhooks, and reconciliation exist. | Open Razorpay only after the backend creates checkout. A browser callback never grants paid access; wait for backend status. |
| Writer subscriber list | No owner list endpoint exists. | Add an owner-authorized, publication-scoped, cursor-paginated read endpoint with bounded fields. Test cross-tenant denial. |
| Writer analytics | Opens/clicks by post/day and milestones exist; current subscriber count is on publication data. | Display available data. A paid-conversion count or historical subscriber graph needs a measured, tenant-scoped aggregate endpoint; do not invent values or draw an empty chart as real data. |
| Quote cards | Text-checked PNG creation and image retrieval exist. | Let the reader select allowed text, submit it, and preview/download the returned PNG. Preserve paid-preview limits. |
| Static public HTML on publish | Architectural intent exists, but the current API serves JSON previews. | Decide and document a publish-triggered generation/invalidation flow before release. Early UI phases may server-render the public preview; do not claim static-on-publish or CDN behavior until implemented and tested. |

The missing reads are support for existing product requirements, not a new feature set. Any new query on large tables needs a bounded result, an index review, and tenant-isolation tests. If the static generation flow changes architecture, record an ADR and update [design.md](design.md).

## Web architecture rules

1. **Next.js App Router in `apps/web`.** Use Server Components for public reading and metadata. Use small Client Components for forms, checkout, selection, and the editor. Keep private writer and reader data uncached (`no-store`).
2. **One browser origin.** Prefer a `/api/*` rewrite to Express so cookie-bearing browser requests stay same-origin. Prove login, logout, `Set-Cookie`, `Origin`, and CSRF behavior with an integration test in the first phase. If rewrites cannot preserve the required behavior, use a small explicit proxy route; keep authorization in Express.
3. **One typed API boundary.** Put request functions and response parsing in `apps/web/src/lib/api`. Share Zod contracts where available. Never let components construct sensitive API URLs or decide entitlement on their own.
4. **No secret storage in the browser.** Keep the session in the existing HttpOnly cookie. Do not put session or signed email tokens in `localStorage`, analytics, logs, or error reports. Razorpay's public test key may reach the browser; its secret and webhook secret stay server-side.
5. **Cache by data sensitivity.** Public previews can use the API's short public cache policy. Paid full bodies, account data, writer drafts, checkout, and subscription status stay private and uncached. Invalidate a changed public post narrowly.
6. **Explicit states.** Every networked view has loading, empty, error, and success states. Map 401 to login, 403 to a genuine access explanation, 409 to a recoverable conflict, 429 to a retry message, and 503 to temporary unavailability. Never turn a 503 entitlement check into a “not subscribed” screen.
7. **Simple dependencies.** Use Next.js, React, Tailwind, existing shared schemas, and Tiptap for the editor. Add libraries only when a concrete interaction cannot be built clearly with the platform and existing packages.

## Build phases

### F0 — Foundation and design proof

**Build:** Create `apps/web` in the pnpm workspace with strict TypeScript, App Router, Tailwind tokens, a minimal layout, `/api/*` integration, typed API helpers, and a small component set. Make a real page proof using a sample English post, a Hindi title, and a Tamil paragraph. Define the paper/ink palette and type scale in code. Verify the Express cookie flow through the web origin before building account screens.

**Review:** Compare screenshots at 360 and 1440 px. Check real text wrapping, focus states, contrast, and a no-JavaScript read view. Keep only components used by the proof. Write down any API contract adjustments discovered during this phase.

**Exit:** `pnpm dev` opens the web app; a public proof page looks intentional on mobile and desktop; the cookie integration test passes; lint, typecheck, and existing tests remain green.

### F1 — Public reading

**Build:** Add the narrow public publication and published-post list API reads. Build `/p/[subdomain]` and `/p/[subdomain]/[slug]` with real data, publication metadata, language tags, dates, excerpts, post body, and a paid preview. Add page title and description metadata, readable 404s, and a simple loading state. Keep the body narrow and links obvious.

**Review:** Test long names, empty publications, free and paid posts, Hindi/Tamil text, link focus, and unpublish. Verify the public list never returns drafts or paid full HTML. Decide the static-on-publish and CDN invalidation implementation, recording an ADR if required.

**Exit:** A new published post appears on its publication page; free content reads correctly; a paid page contains only the preview for an anonymous visitor; cache headers and invalidation are verified without globally clearing the cache.

### F2 — Subscription, accounts, and paid reading

**Build:** Add signup/login/logout; a three-choice delivery slot selector; a timezone field with `Asia/Kolkata` default; subscribe, confirm, preferences, and unsubscribe pages; reader subscription status; Razorpay test-mode checkout; and a clear paid-access state. Complete the email-link compatibility routes before changing `PUBLIC_BASE_URL`. Keep the subscribe result deliberately generic, as the API does.

**Review:** Test incorrect credentials, already-used confirmation and unsubscribe tokens, missed webhook/reconciliation delay, cancelled-but-still-entitled access, 429 responses, and Redis/entitlement 503 behavior. The browser shows “Payment is being confirmed” while backend status is pending. No frontend event or Razorpay callback unlocks the post.

**Exit:** A reader can request confirmation, confirm, change delivery time, unsubscribe, and see the correct paywall decision. Razorpay works in test mode when owner-supplied test keys are configured; without keys the page explains that checkout is unavailable. Playwright covers subscribe, paywall allow/deny, and unsubscribe.

### F3 — Writer workspace

**Build:** Add publication create/list/settings, a calm overview, current subscriber count, milestones, a bounded owner-only reader list, and opens/clicks by post/day. Use one small chart only if it makes the data easier to read; always include a table or labels. If paid-conversion count is shown, add the minimal owner-only aggregate endpoint first. Do not add a fabricated subscriber-growth line.

**Review:** Check empty publications, zero data, a long publication list, large numbers, publication switching, and cross-tenant access. Include a clear “data may be delayed” state for ClickHouse failures rather than showing a misleading zero.

**Exit:** A writer can manage their publication and inspect only their own real data. The list pages paginate; no workspace screen relies on an unbounded response or a frontend-only permission check.

### F4 — Writing and publishing

**Build:** Add draft create/list/edit, a focused Tiptap editor, language and free/paid settings, versioned autosave, a visible save state, scheduled publish settings, publish confirmation, and unpublish. Keep the toolbar small: headings, bold, italic, quote, list, and link. The backend remains responsible for sanitization. Convert scheduled local time to a UTC ISO timestamp, and show the chosen timezone beside the control.

**Review:** Test Hindi and Tamil input methods, pasted HTML, long drafts, slow requests, offline-to-online recovery, a 409 version conflict from two tabs, and repeated publish clicks. A conflict offers a safe reload/copy path; it never silently overwrites another edit. Publishing does not promise email delivery has finished.

**Exit:** A writer can draft, save, schedule or publish, and see the result on the public page. Playwright covers publish and the public read. No duplicate publish event or email is caused by a repeat click.

### F5 — Quote cards, finish, and release check

**Build:** Add text-selection-to-quote-card flow on readable post text, a preview/download action for the returned PNG, polished empty/error states, responsive fixes, and final email-link navigation. Finish the static public HTML/CDN contract decided in F1 before calling the public site release-ready. Keep the same visual language across reader and writer routes.

**Review:** Run keyboard and screen-reader checks on forms, editor controls, dialogs, and paywall. Test reduced motion, 320–1440 px widths, low-bandwidth loading, long Hindi/Tamil lines, and a production build. Review every screen for dead controls, fake data, generic copy, and unnecessary decoration. Measure LCP, INP, and CLS on real routes; record results, never estimates.

**Exit:** The small Playwright suite covers subscribe, publish, receive/read, paywall, and unsubscribe. `pnpm lint`, `pnpm test`, the web build, and manual responsive/accessibility review pass. README and design docs describe what is actually deployed. A friend should be able to find a publication, read a post, subscribe, and write a first draft without a walkthrough.

## Checks that apply to every phase

- Review a running screen, not only code. Capture mobile and desktop screenshots and fix obvious spacing or wrapping problems before starting the next phase.
- Use actual API responses and believable sample writing. Do not make screenshots from placeholder metrics or fake subscriber names.
- Keep a short before/after note for each phase: screens added, API changes, tests run, known limits, and one or two screenshots.
- Run `pnpm lint` and `pnpm test` for every phase. Add focused Playwright tests for critical user flows, with explicit waits rather than arbitrary sleeps.
- Do not tick Phase 8 in the README until both this web track and the separately scoped deployment blueprint are complete. The frontend can be called usable earlier, but a local frontend is not a deployed product.

## Reference material

- [Next.js App Router: Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) and [fetching data](https://nextjs.org/docs/app/getting-started/fetching-data) guide the public-page and small-client-component split.
- [Next.js rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites), [backend-for-frontend guide](https://nextjs.org/docs/app/guides/backend-for-frontend), and [data security guide](https://nextjs.org/docs/app/guides/data-security) inform the one-origin API integration and private-data boundary.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [Core Web Vitals](https://web.dev/articles/vitals/) provide accessibility and measured performance checks.
