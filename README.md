# AbsoluteCinema 🎬

A Video-on-Demand streaming platform: media catalog, HTTP Range video streaming, paid subscriptions (Basic / Plus / Premium), content-based recommendations, and a full admin panel — built per the specifications in [`docs/`](./docs).

## Tech stack

| Layer          | Technology                                                            |
| -------------- | --------------------------------------------------------------------- |
| Frontend       | React 18 + Vite, TypeScript 5.4, Tailwind CSS                         |
| Backend        | NestJS 10, TypeScript 5.4, TypeORM, Passport (JWT + Google OAuth 2.0) |
| Database       | PostgreSQL 14                                                         |
| Infrastructure | Docker Compose (PostgreSQL, Jaeger, Mailpit)                          |
| Payments       | Stripe SDK with built-in mock mode                                    |
| Email          | Nodemailer SMTP (Mailpit in dev)                                      |

## Quick start

Prerequisites: Node.js 22, Docker, FFmpeg (optional — only for generating demo video files).

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
- **Catalog** — search & filters (title, genre, year, country, age rating), sorting, pagination, favorites, 1–10 ratings.
- **Streaming** — HTTP Range requests (206 Partial Content), 480p/720p/1080p quality selection, saved watch progress, subscription-gated access. Renditions become watchable progressively while higher qualities are still transcoding — the Watch page live-polls availability, plays the best ready quality, and disables not-yet-processed ones; stream requests for a missing quality degrade to the best ready rendition. Admins upload **one master video** (drag-and-drop file or URL); a background `fluent-ffmpeg` job transcodes it into every target resolution (never upscaling) and links the variants to the movie automatically.
- **Plan enforcement** — limits are strict and server-side: Basic streams on **1 device** at up to **720p**, Plus on **2 devices** at up to **1080p**, Premium on **4 devices** (1080p, priority support). The SPA heartbeats a per-browser `deviceId` while playing; a stream request for a quality above the plan returns `402 UPGRADE_REQUIRED` (the UI shows an upgrade prompt), and one more device than allowed returns `409 DEVICE_LIMIT` (with a device manager on the profile page; idle slots auto-release after 5 minutes).
- **Recommendations** — content-based filtering over genres/director/actors/keywords weighted by your ratings & history; popular/new fallback for cold start.
- **Subscriptions** — Basic/Plus/Premium, monthly/yearly billing, automated access control with per-tier device-count and quality ceilings.
- **Admin** — movies/genres/actors CRUD with poster & video uploads, user moderation (roles, blocking), analytics dashboard.
- **i18n** — English / Ukrainian with instant switching.
- **Observability** — OpenTelemetry tracing to Jaeger.

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
code. Pull requests and pushes to both branches run container integration checks.
Only `dev` publishes images and can deploy; merging `dev` into `main` does not
deploy. Deployment stays disabled until the repository variable `DEPLOY_ENABLED`
is set to `true` and the GitHub environment `development` is configured.

- [Налаштування Oracle Cloud і CI/CD з нуля](docs/oracle-cloud-cicd.md)
- [Аналіз архітектури, залежностей і обмежень](docs/repository-review.md)

Production-style containers use a separate PostgreSQL 17 volume and persistent
media storage. Do not attach an existing PostgreSQL 14 data volume to PostgreSQL 17.
The separate **Dependency audit** workflow reports existing security debt and
currently fails at the high severity threshold; it is not a deployment gate.
Resolve those findings before using this demo for real customers or payments.
