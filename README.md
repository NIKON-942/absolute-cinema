# AbsoluteCinema 🎬

A Video-on-Demand streaming platform: media catalog, HTTP Range video streaming, paid subscriptions (Basic / Plus / Premium), content-based recommendations, and a full admin panel — built per the specifications in [`docs/`](./docs).

## Tech stack

| Layer          | Technology                                                            |
| -------------- | --------------------------------------------------------------------- |
| Frontend       | React 19 + Vite 8, TypeScript 5.9, Tailwind CSS 3                     |
| Backend        | NestJS 12 / Express 5, TypeScript 5.9, TypeORM, Passport (JWT + Google OAuth 2.0) |
| Database       | PostgreSQL 17 (local and deployment)                                 |
| Infrastructure | Docker Compose (PostgreSQL, Jaeger, Mailpit)                          |
| Payments       | Stripe SDK 23 with built-in mock mode                                 |
| Email          | Nodemailer SMTP (Mailpit in dev)                                      |

## Quick start

Prerequisites: Node.js 24 LTS (see `.nvmrc`), Docker, FFmpeg (optional — only for generating demo video files).

```bash
# 1. Install dependencies (root + backend + frontend)
npm run install:all

# 2. Copy env files
cp .env.example .env
cp backend/.env.example backend/.env   # if the backend ships one, else reuse root values
cp frontend/.env.example frontend/.env

# 3. Start infra + migrate + seed + generate demo videos
npm run db:setup

# 4. Run both apps (API on :4000, SPA on :5173)
npm run dev
```

Services:

For everyday local development, open Docker Desktop and run from the repository root:

```bash
npm run dev
```

The automatic `predev` hook starts PostgreSQL, Mailpit and Jaeger, waits for
readiness, and applies pending migrations before starting the API and Vite in
watch mode. Existing environment files and installed dependencies are required;
demo seeding and video generation are only part of the initial setup above.
Press Ctrl+C to stop the API and Vite. To also stop the Docker services without
deleting their data, run `npm run docker:stop`.

| Service             | URL                            |
| ------------------- | ------------------------------ |
| Web app             | http://localhost:5173          |
| API                 | http://localhost:4000/api      |
| API docs (Swagger)  | http://localhost:4000/api/docs |
| Mailpit (dev inbox) | http://localhost:8025          |
| Jaeger UI (traces)  | http://localhost:16686         |

### Seeded accounts

| Role   | Email                 | Password      |
| ------ | --------------------- | ------------- |
| Admin  | `admin@cinema.local`  | `Admin12345`  |
| Viewer | `viewer@cinema.local` | `Viewer12345` |

The viewer starts without a subscription — use the **Subscription Plans** page and the mock checkout to activate one and unlock streaming.

## Payments: Stripe vs mock mode

Controlled by `STRIPE_ENABLED`:

- `false` (default) — checkout returns a local `/mock-checkout/:sessionId` page that simulates the gateway: "Pay" triggers the webhook lifecycle exactly like Stripe would (order `pending` → webhook → subscription `active` → receipt email).
- `true` — real Stripe Checkout Sessions + webhook with signature verification. Set `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` and forward webhooks (e.g. `stripe listen --forward-to localhost:4000/api/payments/webhook`).

Business rules implemented per `docs/6`: pending orders time out after **20 minutes** (scheduled job) with up to **3 retries** before being marked failed.

## Feature map

- **Auth** — email/password (bcrypt, ≥8 chars), JWT sessions, Google OAuth 2.0, password reset with 24h single-use tokens.
- **Catalog** — search & filters (title, multiple genres with ANY matching, year, country, age rating), sorting, pagination, favorites, 1–10 ratings.
- **Movie page** — `/movie/:id` combines playback, metadata, trailer, cast, ratings, favorites and link sharing. Related movies appear beside the player on desktop and below the details on mobile. Guests can read the page; full-video access requires sign-in and an active subscription. Video loading starts only after pressing Play. Legacy `/watch/:id` links redirect to the movie page.
- **Streaming** — HTTP Range requests (206 Partial Content), 480p/720p/1080p quality selection, saved watch progress, subscription-gated access. Renditions become watchable progressively while higher qualities are still transcoding — the movie page live-polls availability, plays the best ready quality, and disables not-yet-processed ones; stream requests for a missing quality degrade to the best ready rendition. Admins upload **one master video** (drag-and-drop file or URL); a background FFmpeg/ffprobe job transcodes it into every target resolution (never upscaling) and links the variants to the movie automatically.
- **Plan enforcement** — limits are strict and server-side: Basic streams on **1 device** at up to **720p**, Plus on **2 devices** at up to **1080p**, Premium on **4 devices** (1080p, priority support). The SPA heartbeats a per-browser `deviceId` while playing; a stream request for a quality above the plan returns `402 UPGRADE_REQUIRED` (the UI shows an upgrade prompt), and one more device than allowed returns `409 DEVICE_LIMIT` (with a device manager on the profile page; idle slots auto-release after 5 minutes).
- **Recommendations** — content-based filtering over genres/director/actors/keywords weighted by your ratings & history; popular/new fallback for cold start.
- **Subscriptions** — Basic/Plus/Premium, monthly/yearly billing, automated access control with per-tier device-count and quality ceilings.
- **Admin** — movie and dictionary CRUD with poster & video uploads, user moderation (roles, blocking), period-based analytics. Movies reference country/director dictionary IDs; used dictionary records cannot be deleted until reassigned. Metadata and all relation IDs are validated before saving.
- **i18n** — English / Ukrainian with instant switching.
- **Observability** — OpenTelemetry tracing to Jaeger.

## Media requirements update

Migration `1793700000000-MediaRequirements` moves existing movie country/director names into dictionaries and adds foreign keys. Non-empty legacy names missing from a dictionary are preserved as new records; blank references become null. The API still returns display names together with `countryId`/`directorId`. Admin forms submit IDs. Legacy name inputs resolve only existing records. Optional fields can be explicitly cleared in PATCH requests.

The same migration adds playback and rating event tables. A view is one player session reported after Play and a successful device heartbeat, deduplicated by user/movie/playback ID. Pauses, quality changes, metadata preloading, HEAD and Range requests do not add views. Reloading or reopening the movie creates a new session. Lifetime view counts are preserved; historical events with unknown dates are not invented.

Analytics over the selected trailing period count the new playback events and use each viewer's latest rating action for each movie within that period. Clearing a rating excludes that viewer's rating from that window; editing it replaces their earlier value. Genre averages are weighted by individual ratings, not by movie averages. A movie belonging to multiple genres contributes to each genre, so genre totals are not additive. User/movie/subscription totals show the current state. Deleting a user or movie also deletes their related event rows.

Apply migrations before starting the new backend: `npm --prefix backend run migration:run` for local environments, or the compiled migration runner in deployment. The standard `npm run dev` startup and Oracle deployment already run pending migrations. The previous backend requires reverting this migration before it can use the normalized schema again; deployment does not automatically reverse migrations.

Regression coverage is part of `backend/scripts/review-regressions.test.mjs` and `frontend/scripts/auth-regressions.test.mjs`. The separate `backend/scripts/requirements-migration.mjs` checks legacy backfill, repeatability and rollback, and refuses to run unless `ALLOW_SMOKE_FIXTURES=true`, `DB_NAME=cinema_review` and the database is fresh and disposable.

## Project layout

```
absolutecinema/
├── docs/            # Specifications + shared API contract (docs/api-contract.md)
├── diagrams/        # C4 architecture diagrams
├── backend/         # NestJS API (modules: auth, users, media, recommendations, payments, mail)
├── frontend/        # React SPA (pages, components, contexts, hooks, services)
├── docker-compose.yml
└── package.json     # Root script runner
```

## GDPR / security notes

- Passwords stored as bcrypt hashes only; secrets via environment variables.
- Card data never touches the server (Stripe-hosted checkout).
- Watch history is scoped per user with documented retention (1 year from last activity).

## Oracle Cloud and CI/CD

The `dev` branch is the Oracle test environment; `main` holds the reviewed stable
code. Runtime changes in pull requests and pushes to both branches build the
containers and run the basic login, API, subscription, streaming and device-limit
smoke checks. Changes only to documentation skip builds and deployment.
Additional checks are selected from the changed paths: auth/payment regressions,
image/resumable uploads, FFmpeg processing, and migration/bootstrap repeatability.
Frontend tests reuse the Docker build stage's dependencies instead of installing
them again on the runner. The Actions summary shows the selected scopes.

Pull requests into `main`, direct runtime pushes to `main`, and manual runs execute
the full suite. Dependency manifests/lockfiles, Docker/build configuration and CI
changes also enable every check. If the previous Git revision cannot be read,
the workflow runs the full suite rather than guessing which checks to omit.

Only `dev` publishes images and can deploy; merging `dev` into `main` does not
deploy. Deployment stays disabled until the repository variable `DEPLOY_ENABLED`
is set to `true` and the GitHub environment `development` is configured.

- [Налаштування Oracle Cloud і CI/CD з нуля](docs/oracle-cloud-cicd.md)
- [Аналіз архітектури, залежностей і обмежень](docs/repository-review.md)

Production-style containers use a separate PostgreSQL 17 volume and persistent
media storage. Do not attach an existing PostgreSQL 14 data volume to PostgreSQL 17.
The separate **Dependency audit** workflow checks root, backend and frontend at
the high severity threshold; it is not a deployment gate. Root, backend and frontend have
no audit findings (snapshot: 2026-11-01). See [dependency upgrade notes](docs/dependency-upgrades.md)
for the earlier transitive fixes and remaining work.

## Google sign-in setup

The supported production callback for the current domain is `https://absolutecine.duckdns.org/api/auth/google/callback`. In Google Auth Platform create a **Web application** OAuth client, configure branding/audience and register that exact authorized redirect URI. For local development use a separate client with `http://localhost:4000/api/auth/google/callback`. This server redirect flow does not require a frontend client secret or Google JavaScript SDK.

On Oracle set `SITE_ADDRESS=absolutecine.duckdns.org`, `CLIENT_URL=https://absolutecine.duckdns.org`, `GOOGLE_CALLBACK_URL=https://absolutecine.duckdns.org/api/auth/google/callback`, plus `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the server environment. Never commit the secret. If Google requests domain verification, verify control of this hostname; the code cannot configure the Google project or publish its consent screen. Restart/recreate the backend after updating its environment.

Migration `1793780000000-GoogleOAuthFlows` adds unique Google identities and short-lived OAuth flows. Existing duplicate non-null Google IDs must be reviewed before migrating; accounts are never merged automatically. State is bound to an HttpOnly SameSite=Lax cookie and consumed once. The callback passes a one-minute exchange code in the URL fragment; exchange requires the same browser cookie and consumes the code atomically. JWTs are no longer accepted from callback URLs. Expired flows are cleaned periodically and when starting sign-in.

New Google users get a viewer account. Existing Google identities sign in by Google ID. Existing password users must first sign in normally, then choose **Link Google account** in their profile; matching email alone never links accounts. Linking checks the initiating session version again at callback. Profile DTOs expose only `googleLinked`, not the provider ID. Sign-in returns to a validated internal destination and handles cancellation, expired state, configuration errors and account conflicts on the normal authentication UI.

## Public Google OAuth branding and policies

Public URLs after deploying this change:

| Google Auth Platform field | Value |
| --- | --- |
| Application name | AbsoluteCinema |
| Application home page | https://absolutecine.duckdns.org/ |
| Application privacy policy | https://absolutecine.duckdns.org/privacy |
| Application terms of service | https://absolutecine.duckdns.org/terms |
| Authorized domain | absolutecine.duckdns.org |
| Audience | External |
| Publishing status | In production, once the public pages are deployed and verified |
| Data Access | openid, userinfo.email, userinfo.profile only |

The confirmed project/privacy contact is Микита Губін (Mykyta Hubin), hubin.mykyta_ip42@edu.kpi.ua. Google’s User support email dropdown only permits eligible signed-in accounts or managed groups: select a monitored address available there. A privacy contact on the site does not automatically make that address selectable in Google Console.

Deploy first, then open the home, privacy and terms URLs signed out. In Google Auth Platform, verify the domain if requested, update Branding, use **Verify Branding** / **Publish branding** when shown, and set Audience to **In production** through **Publish app**. Publishing the audience and verifying branding are separate actions. This repository does not change Google Console settings; project-owner access is required. Scope verification and Google Workspace administrator restrictions may still apply independently.

Policy text lives in `frontend/src/content/privacy.json` and `terms.json`. Keep the text and revision date consistent with actual operation; update recipients and retention disclosures when server configuration changes. The same text is rendered by the SPA and emitted as bilingual, script-free HTML for direct requests. Caddy explicitly serves both public routes with revalidation. The homepage includes legal links and a service description even without JavaScript. The frontend scripts explicitly select `vite.config.ts` so generated local `vite.config.js` files cannot bypass the static-page build plugin.

The existing CI smoke job runs `node frontend/scripts/check-public-pages.mjs http://localhost` to verify the public documents, both language versions, contact links, canonical URLs, cache headers and homepage links through Caddy.
