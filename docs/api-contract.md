# AbsoluteCinema — API Contract (implemented backend/frontend contract)

Reviewed 2026-11-05 against the current controllers, services and types. This describes implementation, not proof of full ТЗ/РГР2 compliance. See [requirements](4_Functional_Requirements.md), [implementation](implementation-status.md), and [gaps](verification-and-gaps.md). In particular, head-administrator authorization and movie hide/unhide are not implemented.

Base URL: `http://localhost:4000/api`
Auth: `Authorization: Bearer <accessToken>` on protected endpoints.
For native video requests, `?token=<accessToken>` is also supported by JWT extraction. The extractor currently accepts this form beyond the stream route; avoid logging query strings. The normal API client uses Bearer headers. Payment access never changes the administrative user role.
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
  googleLinked: boolean; // whether a Google identity is linked
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
  year: number;
  genres: { id: number; name: string }[];
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
| GET | `/auth/google` | — | `?returnTo=/movie/1` (internal path only) | browser-bound state cookie and redirect to Google; errors return to OAuth UI |
| GET | `/auth/google/callback` | state + browser cookie | `?code=...&state=...` or denial | 302 → `CLIENT_URL/auth/oauth-success#code=<one-use-code>`; JWT is never put in the URL |
| POST | `/auth/google/exchange` | same browser cookie | `{ code }` | `{ accessToken, returnTo }`; code expires after one minute and is consumed once |
| POST | `/auth/google/link` | Bearer | — | `{ url }`; explicit link to the signed-in account, checked again at callback |
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
| PATCH | `/users/:id/role` | admin | `{ role: 'viewer'\|'admin' }` | `UserDto` |
| PATCH | `/users/:id/block` | admin | `{ isBlocked: boolean }` | `UserDto` |
| DELETE | `/users/:id` | admin | — | 200 with empty body (current Nest default; no explicit 204 decorator) |

Blocked users: login returns 403 `Account is blocked`.
All admin users currently have role/block/delete endpoints. The last active admin cannot lose access, but this does not implement the head-admin restriction in ТЗ 4.1.1–4.1.2 / РГР2 FR-42. Register and Google link use the default POST status 201; login/logout/Google exchange/forgot/reset explicitly return 200. The unknown-email recovery response has the same status/body as the known-email response.

## Media (`/media`)

| Method | Path | Auth | Body/Query | Returns |
|---|---|---|---|---|
| GET | `/media` | — | `?search=&genre=<legacy-name>&genreIds=1,2&year=&yearFrom=&yearTo=&country=&ageRating=&sort=popularity\|rating\|newest&page=1&limit=20` | `{ items: MovieDto[], total, page, limit }` |
| GET | `/media/:id` | — (isFavorite/userRating only when auth) | — | `MovieDto` |
| GET | `/media/:id/similar` | — | — | `MovieDto[]` (up to 8, ranked by shared genres, FR-33) |
| GET | `/media/genres` | — | — | `GenreDto[]` |
| GET | `/media/actors` | — | — | `ActorDto[]` |
| GET | `/media/countries` | — | — | `CountryDto[]` (FR-38) |
| GET | `/media/directors` | — | — | `DirectorDto[]` (FR-39) |
| GET | `/media/posters/:filename` | — | — | image file |
| GET | `/media/:id/stream` | Bearer + active subscription | `?quality=480p\|720p\|1080p&deviceId=<uuid>`, Range header supported | `206 Partial Content` video/mp4 stream (`Accept-Ranges: bytes`). If the requested quality is not ready yet (transcoding in progress) the best ready quality **within the plan cap** is served instead; `409` only when no rendition is ready. Plan enforcement: `?quality` above the tier's cap → `402` `{ code: 'UPGRADE_REQUIRED', requestedQuality, maxQuality }`; `deviceId` identifies the streaming device (see `/devices`) and a not-yet-registered device beyond the tier's `maxDevices` → `409` `{ code: 'DEVICE_LIMIT', maxDevices, activeDevices }` |
| POST | `/media/:id/playback` | Bearer + active subscription | `{ playbackId: string }` (16–100 letters/digits/underscores/hyphens) | `{ message }`; idempotent per user/movie/session |
| POST | `/media/:id/favorites` | Bearer | — | `{ isFavorite: boolean }` (toggle) |
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
| DELETE | `/media/:id` | 200 with empty body (no explicit 204 decorator) |
| POST | `/media/:id/master-video` | multipart: `file`, up to 8 GiB, MP4 (H.264/H.265 with AAC when audio is present) or WebM → `MovieDto` with `transcodeStatus: 'processing'`; background processing creates 480p/720p/1080p variants no higher than the source |
| GET | `/media/:id/transcode` | `{ movieId, status: none\|processing\|ready\|failed, qualities: string[], error? }` — live background-job state for polling |
| POST | `/media/genres` / PATCH `/media/genres/:id` / DELETE | `{ name }` |
| POST | `/media/actors` / PATCH `/media/actors/:id` / DELETE | JSON `{ name, photoUrl? }` or multipart `{ name, photoUrl?, file? }` (actor image) |
| POST | `/media/countries` / PATCH `/media/countries/:id` / DELETE | `{ name }` (FR-38) |
| POST | `/media/directors` / PATCH `/media/directors/:id` / DELETE | `{ name }` (FR-39) |

Video pipeline: administrators provide ONE master source (upload or URL). A durable pending source is stored in PostgreSQL; the single-process queue resumes interrupted jobs on startup. Direct FFmpeg subprocesses render resolutions no higher than the source as faststart H.264/AAC MP4s. New movies publish completed renditions progressively; replacements preserve the previous video until every new rendition succeeds. Remote sources are downloaded with public-address validation, DNS pinning, redirect checks, an 8 GiB limit and a 15-minute download deadline. FFmpeg/ffprobe accept local files only. Uploaded masters must be MP4 (H.264/H.265, AAC if audio is present) or WebM; posters must be JPG/PNG/WebP up to 5 MiB, with byte-signature validation.

## Recommendations (`/recommendations`)

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/recommendations` | Bearer (optional) | `MovieDto[]` (up to 12 items; content-based from ratings ≥6 + watch history via SQL scoring on genres/director/actors/keywords; fallback = popular+newest for guests / no-history users) |

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

Google OAuth uses verified provider profiles and identifies returning users by Google ID. A matching email alone never merges accounts: password users sign in normally and link Google in Profile. Blocked accounts and revoked linking sessions are rejected. Provider IDs are unique; DTOs expose only `googleLinked`. State expires after ten minutes, is consumed once and must match an HttpOnly, SameSite=Lax browser cookie (Secure for HTTPS callbacks). Concurrent/replayed exchanges cannot issue the token twice. Missing credentials, denied consent, state errors and account conflicts return localized authentication UI messages.

## Streaming details and health endpoints

`GET /api` returns service information. `GET /api/health/ready` executes `SELECT 1`, returning 200 `{ status: 'ok' }` or 503. There is no separate `/api/health` handler. Swagger is exposed at `/api/docs` only outside production.

`HEAD /media/:id/stream` uses the same JWT/subscription/device/quality checks as GET and returns content headers without a body. GET with a valid single Range returns 206; without Range it returns 200. Unsatisfiable or malformed ranges (including unsupported multi-range) return 416. A missing deviceId is 400; no active subscription is 403. Legacy remote rendition paths can redirect with 302. Fresh master uploads produce local MP4 renditions.

## Resumable video uploads (`/media/uploads`, admin + owner)

The frontend uses this transport for large files. It combines tus 1.0 headers with application-specific JSON creation and explicit completion; it is not a generic tus server API. Chunk size is 16 MiB, maximum file size 8 GiB. The manifest contains lowercase hex SHA-256 for the whole file and each chunk.

| Method | Path | Input | Result |
|---|---|---|---|
| OPTIONS | `/media/uploads` | Authorized request | 204; Tus-Version 1.0.0, creation/checksum/termination extensions, sha1/sha256, Tus-Max-Size |
| GET | `/media/uploads` | Bearer | Current admin's upload sessions |
| POST | `/media/uploads/:movieId` | Tus-Resumable 1.0.0; JSON `{ filename, size, sha256, chunks: string[] }` | 201 upload session, Location, Upload-Offset |
| HEAD | `/media/uploads/:id` | Tus-Resumable 1.0.0 | Upload-Offset and Upload-Length |
| GET | `/media/uploads/:id` | Bearer | Session state and current job when available |
| PATCH | `/media/uploads/:id` | Tus-Resumable 1.0.0; Upload-Offset; Upload-Checksum; Content-Type application/offset+octet-stream; binary chunk | 204 with durable Upload-Offset |
| POST | `/media/uploads/:id/complete` | Bearer | 202; start whole-file verification and transcode |
| DELETE | `/media/uploads/:id` | Bearer | 204; cancel/remove when processing has not started |

The SPA sends `Upload-Checksum: sha256 <base64 digest>`. Incorrect tus version is 412; offset/state conflicts are 409. Reconcile an uncertain PATCH using HEAD. Upload IDs are UUID-like and owner-scoped. States: uploading → verifying → processing → ready, or failed. After browser reload, resuming may require selecting the same file again. Upload records expire after seven days of inactivity, with active verification/processing protected from cleanup.

```ts
interface UploadSession {
  id: string;
  movieId: number;
  movieTitle: string;
  filename: string;
  size: number;
  sha256: string;
  offset: number;
  state: 'uploading' | 'verifying' | 'processing' | 'ready' | 'failed';
  chunkSize: number;
  expiresAt: string;
  error?: string;
  job?: TranscodeJobDto;
}
interface TranscodeJobDto {
  movieId: number;
  status: 'none' | 'processing' | 'ready' | 'failed';
  qualities: string[];
  progress: number | null;
  phase: 'queued' | 'probing' | 'audio' | 'converting' | 'finalizing' | 'ready' | 'failed' | 'unavailable' | 'none';
  currentQuality: '480p' | '720p' | '1080p' | null;
  targetQualities: string[];
  renditions?: Array<{
    quality: string; progress: number | null;
    state: 'queued' | 'converting' | 'finalizing' | 'ready' | 'failed';
    mode: 'copy' | 'encode';
  }>;
  startedAt?: string | null;
  finishedAt?: string | null;
  elapsedSeconds?: number;
  remainingSeconds?: number | null;
  error?: string;
}
```

Job progress/ETA are runtime estimates; source and movie lifecycle persist across restart, while detailed in-memory progress is reconstructed. `null` progress/ETA means unavailable, not zero. Upload byte completion and playable video readiness are separate phases.
