# AbsoluteCinema — API Contract (shared source of truth for backend & frontend)

Base URL: `http://localhost:4000/api`
Auth: `Authorization: Bearer <accessToken>` on protected endpoints.
All responses JSON unless noted. Errors follow NestJS shape:

```json
{ "statusCode": 400, "message": "string | string[]", "error": "Bad Request" }
```

Roles: `viewer`, `admin`. Subscription tiers: `basic`, `plus`, `premium` (stored on user's active subscription; access to streaming requires an active subscription of any tier). Each tier enforces limits — max concurrent streaming devices and max playback quality — that the backend validates on every stream request:

| Tier | Monthly | Yearly | Max devices | Max quality | Extras |
|------|---------|--------|-------------|-------------|--------|
| basic | 4.99 | 49.99 | 1 | 720p | full catalog |
| plus | 9.99 | 99.99 | 2 | 1080p | everything in Basic |
| premium | 14.99 | 149.99 | 4 | 1080p | everything in Plus + priority support |

---

## Data models (DTO shapes returned to the client)

```ts
interface UserDto {
  id: number;
  email: string;
  name: string;
  role: 'viewer' | 'admin';
  isBlocked: boolean;
  avatarUrl: string | null;      // shown in navbar/profile (FR-35)
  hasActiveSubscription: boolean;
  activeSubscription: SubscriptionDto | null;
  createdAt: string; // ISO
  lastLoginAt: string | null;    // shown in admin users table (FR-41)
}

interface MovieDto {
  id: number;
  title: string;
  originalTitle: string;
  description: string;
  year: number;
  country: string;
  countryId: number | null;
  ageRating: string;   // e.g. "12+", "16+", "18+"
  director: string;
  directorId: number | null;
  runtimeMinutes: number | null; // FR-33
  trailerUrl: string | null;     // FR-33
  keywords: string[];  // tags array
  posterUrl: string;   // "/api/media/posters/xxx.jpg" or an external http(s) URL
  masterVideoUrl: string | null;      // remote master URL when provided
  transcodeStatus: 'none' | 'processing' | 'ready' | 'failed';
  genres: GenreDto[];
  actors: ActorDto[];
  viewCount: number;
  averageRating: number; // 0..10, one decimal, 0 if no ratings
  userRating: number | null; // 1..10 if authenticated user rated
  isFavorite: boolean;      // for authenticated user
  availableQualities: ('480p'|'720p'|'1080p')[];
  createdAt: string;
}

interface GenreDto { id: number; name: string; }
interface ActorDto { id: number; name: string; photoUrl?: string; }
interface CountryDto { id: number; name: string; }   // FR-38 dictionary
interface DirectorDto { id: number; name: string; }  // FR-39 registry

interface SubscriptionDto {
  id: number;
  tier: 'basic' | 'plus' | 'premium';
  period: 'monthly' | 'yearly';
  status: 'pending' | 'active' | 'expired' | 'cancelled';
  startsAt: string | null;
  endsAt: string | null;
  cancelAtPeriodEnd: boolean;
  autoRenew: boolean; // false in mock mode and after renewal cancellation
}

interface WatchProgressDto {
  movieId: number;
  movieTitle: string;
  posterUrl: string;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: string;
}

interface PlanDto {
  tier: 'basic' | 'plus' | 'premium';
  monthlyPrice: number; // in currency units, e.g. 4.99
  yearlyPrice: number;
  currency: 'usd';
  maxDevices: number;       // concurrent streaming devices (enforced server-side)
  maxQuality: '480p' | '720p' | '1080p'; // highest requestable quality
  prioritySupport: boolean; // premium only
  features: string[]; // localized feature bullets handled client-side by tier key
}

interface DeviceSessionDto {
  deviceId: string;    // client-generated UUID kept in localStorage
  name: string | null; // browser/OS label derived from the User-Agent
  lastSeenAt: string;  // ISO; sessions silent for 5 minutes release their slot
  createdAt: string;
}
```

## Pricing (fixed, seeded)

| Tier | Monthly | Yearly |
|------|---------|--------|
| basic | 4.99 | 49.99 |
| plus | 9.99 | 99.99 |
| premium | 14.99 | 149.99 |

---

## Auth (`/auth`)

| Method | Path | Auth | Body / Query | Returns |
|---|---|---|---|---|
| POST | `/auth/register` | — | `{ email, password (min 8), name }` | `{ user: UserDto, accessToken }` + welcome email |
| POST | `/auth/login` | — | `{ email, password }` | `{ user: UserDto, accessToken }` (updates lastLoginAt) |
| POST | `/auth/logout` | Bearer | — | `{ message }` — revokes all issued tokens (FR-36) |
| GET | `/auth/google` | — | — | redirects to Google |
| GET | `/auth/google/callback` | — | `?code=...` | 302 → `CLIENT_URL/auth/oauth-success#token=<jwt>` |
| GET | `/auth/me` | Bearer | — | `UserDto` |
| POST | `/auth/forgot-password` | — | `{ email }` | `{ message }` (always 200; email with reset link `/reset-password?token=...`) |
| POST | `/auth/reset-password` | — | `{ token, newPassword }` | `{ message }` (token valid 24h) |

Password rules (РГР2 FR-2): at least 8 Unicode code points, at most 72 UTF-8 bytes (bcrypt limit). The same rule applies to registration, reset and profile changes. Five incorrect login attempts lock password sign-in for one hour. Changing a password revokes all JWTs and requires signing in again.

## Users (`/users`, admin unless noted)

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/users` | admin | `?page=1&limit=20&search=` | `{ items: UserDto[], total, page, limit }` |
| GET | `/users/me` | Bearer | — | `UserDto` |
| PATCH | `/users/me` | Bearer | JSON `{ name?, avatarUrl?, password?, currentPassword? }` or multipart with the same fields plus `file?` (avatar image). `currentPassword` required for a password change. | `UserDto` |
| PATCH | `/users/:id/role` | admin | `{ role: 'viewer'|'admin' }` | `UserDto` |
| PATCH | `/users/:id/block` | admin | `{ isBlocked: boolean }` | `UserDto` |
| DELETE | `/users/:id` | admin | — | 204 |

Blocked users: login returns 403 `Account is blocked`.

## Media (`/media`)

| Method | Path | Auth | Body/Query | Returns |
|---|---|---|---|---|
| GET | `/media` | — | `?search=&genre=<legacy-name>&genreIds=1,2&year=&yearFrom=&yearTo=&country=&ageRating=&sort=popularity|rating|newest&page=1&limit=20` | `{ items: MovieDto[], total, page, limit }` |
| GET | `/media/:id` | — (isFavorite/userRating only when auth) | — | `MovieDto` |
| GET | `/media/:id/similar` | — | — | `MovieDto[]` (up to 8, ranked by shared genres, FR-33) |
| GET | `/media/genres` | — | — | `GenreDto[]` |
| GET | `/media/actors` | — | — | `ActorDto[]` |
| GET | `/media/countries` | — | — | `CountryDto[]` (FR-38) |
| GET | `/media/directors` | — | — | `DirectorDto[]` (FR-39) |
| GET | `/media/posters/:filename` | — | — | image file |
| GET | `/media/:id/stream` | Bearer + active subscription | `?quality=480p|720p|1080p&deviceId=<uuid>`, Range header supported | `206 Partial Content` video/mp4 stream (`Accept-Ranges: bytes`). If the requested quality is not ready yet (transcoding in progress) the best ready quality **within the plan cap** is served instead; `409` only when no rendition is ready. Plan enforcement: `?quality` above the tier's cap → `402` `{ code: 'UPGRADE_REQUIRED', requestedQuality, maxQuality }`; `deviceId` identifies the streaming device (see `/devices`) and a not-yet-registered device beyond the tier's `maxDevices` → `409` `{ code: 'DEVICE_LIMIT', maxDevices, activeDevices }` |
| POST | `/media/:id/playback` | Bearer + active subscription | `{ playbackId: string }` (16–100 letters/digits/underscores/hyphens) | `{ message }`; idempotent per user/movie/session |
| POST | `/media/:id/favorites` | Bearer | — | `{ isFavorite: true }` (toggle) |
| GET | `/media/favorites` | Bearer | — | `MovieDto[]` |
| PUT | `/media/:id/rating` | Bearer | `{ value: 1..10 }` | `{ averageRating, userRating }` |
| DELETE | `/media/:id/rating` | Bearer | — | `{ averageRating, userRating: null }` |
| PUT | `/media/:id/progress` | Bearer | `{ positionSeconds, durationSeconds }` | `{ message }` |
| GET | `/media/progress` | Bearer | — | `WatchProgressDto[]` |

### Admin media CRUD (role: admin)
| Method | Path | Body (JSON unless noted) |
|---|---|---|
| POST | `/media` | multipart/form-data: `file?` (poster image), plus fields `title, originalTitle?, description, year, countryId?, ageRating?, directorId?, runtimeMinutes?, trailerUrl?, keywords? (comma string), posterUrl? (http URL alternative), masterVideoUrl? (http master video URL — transcoded server-side), genreIds: number[], actorIds?: number[]` → `MovieDto` |
| PATCH | `/media/:id` | same multipart shape (all optional) |
| DELETE | `/media/:id` | 204 |
| POST | `/media/:id/master-video` | multipart: `file` (single master video, any ffmpeg-readable container) → `MovieDto` with `transcodeStatus: 'processing'`; the server renders 480p/720p/1080p H.264/AAC variants in the background and links them to the movie |
| GET | `/media/:id/transcode` | `{ movieId, status: none|processing|ready|failed, qualities: string[], error? }` — live background-job state for polling |
| POST | `/media/genres` / PATCH `/media/genres/:id` / DELETE | `{ name }` |
| POST | `/media/actors` / PATCH `/media/actors/:id` / DELETE | JSON `{ name, photoUrl? }` or multipart `{ name, photoUrl?, file? }` (actor image) |
| POST | `/media/countries` / PATCH `/media/countries/:id` / DELETE | `{ name }` (FR-38) |
| POST | `/media/directors` / PATCH `/media/directors/:id` / DELETE | `{ name }` (FR-39) |

Video pipeline: administrators provide ONE master source (upload or URL). A durable pending source is stored in PostgreSQL; the single-process queue resumes interrupted jobs on startup. Direct FFmpeg subprocesses render resolutions no higher than the source as faststart H.264/AAC MP4s. New movies publish completed renditions progressively; replacements preserve the previous video until every new rendition succeeds. Remote sources are downloaded with public-address validation, DNS pinning, redirect checks, an 8 GiB limit and a 15-minute download deadline. FFmpeg/ffprobe accept local files only. Uploaded masters must be MP4 (H.264/H.265, AAC if audio is present) or WebM; posters must be JPG/PNG/WebP up to 5 MiB, with byte-signature validation.

## Recommendations (`/recommendations`)

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/recommendations` | Bearer (optional) | `MovieDto[]` (12 items; content-based from ratings ≥6 + watch history via SQL scoring on genres/director/actors/keywords; fallback = popular+newest for guests / no-history users) |

## Payments (`/payments`)

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/payments/plans` | — | — | `PlanDto[]` |
| POST | `/payments/checkout` | Bearer | `{ tier, period }` | `{ checkoutUrl }` — Stripe hosted checkout when `STRIPE_ENABLED=true`, otherwise `{ checkoutUrl: "/mock-checkout/<sessionId>" }` on the frontend |
| POST | `/payments/mock-complete/:sessionId` | Bearer | — | `{ message }` — mock mode only: simulates the gateway webhook (activates subscription, grants access, sends receipt email) |
| POST | `/payments/mock-cancel/:sessionId` | Bearer | — | `{ message }` — mock mode only: marks order cancelled |
| POST | `/payments/subscription/cancel` | Bearer | — | `{ message }` — turns off Stripe automatic renewal, preserves access until `endsAt`, cancels pending checkouts |
| POST | `/payments/retry/:sessionId` | Bearer, order owner | — | `{ checkoutUrl }` — closes an abandoned checkout and creates a new attempt, up to 3 retries per order chain |
| POST | `/payments/webhook` | Stripe sig header | raw body | 200; verifies signatures, handles paid Checkout, paid renewal invoices, checkout expiration and subscription updates/deletion; duplicate payments are idempotent |

Subscription activation and the paid transaction commit together under a per-user lock. Stripe billing dates are authoritative; mock calendar dates clamp to the last day of the target month. Pending checkouts expire after 20 minutes (cron); retries require a user action and never rewrite the original `createdAt`. Stripe mode requires both secret key and webhook secret; missing credentials stop startup instead of enabling mock payments.

Configure the Stripe event destination for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `invoice.paid`, `customer.subscription.updated`, and `customer.subscription.deleted`. Existing live subscriptions created before external IDs were stored require reconciliation with Stripe; the migration cannot infer these IDs.

## Devices (`/devices`, Bearer)

Concurrent-device enforcement. The SPA generates a persistent `deviceId` (localStorage UUID), sends it on every stream request (`&deviceId=`) and heartbeats `POST /devices/heartbeat` while playing. Sessions silent for **5 minutes** release their slot automatically.

| Method | Path | Body/Query | Returns |
|---|---|---|---|
| POST | `/devices/heartbeat` | `{ deviceId }` | `{ activeDevices, maxDevices }`; `409 { code: 'DEVICE_LIMIT', maxDevices, activeDevices }` when a new device would exceed the plan's concurrent limit |
| GET | `/devices` | — | `{ devices: DeviceSessionDto[], maxDevices }` |
| POST | `/devices/end` | `?deviceId=` (sendBeacon-friendly) | `{ message }` — releases this device's slot immediately |
| DELETE | `/devices/:deviceId` | — | `{ message }` — disconnects one of the user's devices from the profile page |

## Admin analytics (`/admin`)

| Method | Path | Returns |
|---|---|---|
| GET | `/admin/analytics?days=30` | `{ totalUsers, totalMovies, activeSubscriptions, intervalDays, periodFrom, periodTo, viewsInPeriod, averageRatingInPeriod, newUsersInPeriod, topMovies: { id, title, viewCount, averageRating }[], genrePopularity: { genre, views, movies, averageRating }[], revenueByMonth: { month, total }[] }` — views, audience ratings, genre popularity, revenue and new users use the selected period; global totals show the current state (FR-43/44) |

## Image attachments

Profile avatars, actor photos and movie posters use file attachments as the primary UI action, with external URLs available in a secondary disclosure. Accepted files: JPG/JPEG, PNG and WebP up to 5 MiB, validated by MIME/extension and byte signature. Uploaded files are stored in the existing persistent media volume and served through `/api/media/posters/:filename`; the saved avatar/photo/poster URL remains valid after reload and deployment. A file takes precedence over a supplied URL. Empty image URL clears the image (`null` also supported for avatars). User avatars require authentication; actor/poster changes require admin access. No database migration is required for image attachment support.

## Mail

Transactional emails via SMTP (Mailpit at http://localhost:8025 in dev): welcome, password reset, payment receipt.

## Misc
- CORS enabled for `CLIENT_URL`.
- Video streaming endpoint requires `Range` support (`206`, `Content-Range`, `Accept-Ranges: bytes`).
- Seeded accounts: `admin@cinema.local` / `Admin12345` (admin), `viewer@cinema.local` / `Viewer12345` (viewer).

### Media filter, dictionary and analytics semantics

- `genreIds` is a comma-separated list of positive IDs (ANY: at least one selected genre). It combines with all other filters. All genres of each matched movie are returned. The legacy single `genre=<name>` remains supported; non-empty `genreIds` takes precedence.
- Movie writes accept existing `countryId` and `directorId`; null/empty clears the relation. Legacy `country`/`director` names resolve existing dictionary entries; do not provide both the name and ID for a field. Renames are reflected through relations. Deleting a dictionary record used by a movie returns 409; missing records return 404.
- Create/PATCH accept JSON or multipart metadata. Relation lists accept JSON arrays (the frontend uses this format) or legacy comma-separated values. Invalid or unknown IDs return 400; omitted PATCH fields remain unchanged and empty lists clear relations. Unknown metadata fields return 400. Title/name: 1–255 trimmed characters; year: integer 1890–2100; runtime: integer 1–600 minutes or empty/null; age rating: 0+/6+/12+/16+/18+/21+; description: up to 20000 characters; URLs: HTTP(S), up to 2048 characters; up to 50 tags of at most 100 characters.
- Playback events are reported after actual Play, once per player session. Retry with the same playbackId does not increment views. Pauses, quality changes and Range/HEAD requests do not count additional views. Lifetime counters are preserved; period reports use only recorded events since migration.
- Period bounds are `[periodFrom, periodTo)`. For each user/movie, the latest rating action within the period is counted once; a clear action excludes that rating. Genre averages weight individual ratings equally. Multi-genre views contribute to every associated genre and must not be summed as unique global views. Deleting the user/movie cascades to their event history.
