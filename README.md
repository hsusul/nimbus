# Nimbus

Nimbus is an API-first cloud file workspace built to demonstrate storage-system engineering end to end. It combines PostgreSQL metadata, private S3-compatible object storage, resumable uploads, immutable versions, scoped sharing, authorization-safe search, durable BullMQ workers, and a responsive Next.js console.

Current status: **M9 Web Console and Productization complete locally**. The console exercises the implemented M1-M8 backend through public API contracts; it does not query Prisma or use an object-storage SDK.

## Architecture

```text
Browser
  |-- JSON metadata/auth requests --> Express API --> PostgreSQL
  |-- signed PUT/GET bytes -----------------------> MinIO / S3
  |                                  |
  |                                  +--> Redis / BullMQ --> Worker
  |                                                         |-- upload finalization
  |                                                         |-- metadata indexing
  |                                                         |-- thumbnails
  |                                                         +-- upload cleanup
  +<-- Next.js App Router console -- apps/web
```

| Area       | Implementation                                                      |
| ---------- | ------------------------------------------------------------------- |
| Web        | Next.js App Router, React, shared Zod contracts, Playwright         |
| API        | Express, centralized `PermissionService`, strict error envelopes    |
| Metadata   | PostgreSQL, Prisma, cursor pagination, soft delete/restore          |
| Bytes      | Private MinIO/S3 objects and short-lived signed URLs                |
| Async work | Redis, BullMQ, durable `BackgroundJob` rows                         |
| Tests      | Vitest integration/unit suites, real local MinIO smokes, Playwright |

## Implemented Features

- Dense desktop-first file browser with responsive navigation, breadcrumbs, loading/error/empty states, dialogs, and file detail drawer.
- Folder create, rename, move, soft delete, restore, and cursor-based browsing.
- Single-part and multipart direct uploads with progress, bounded concurrency, transient retry, API cancellation, and safe reselect-to-resume records.
- Authorized downloads, immutable version history, new-version upload, and direct-pointer restore.
- Existing-user viewer/editor shares, revocation, one-time public links, and scoped public metadata/downloads.
- Authorization-safe metadata search across owned and directly shared resources.
- Lazy private thumbnails for JPEG, PNG, and WebP.
- Owner-scoped background-job visibility and soft-deleted resource listing.
- Audit logs, request/correlation IDs, structured redaction, and deny-by-default authorization.

`Shared with me` is intentionally omitted because the API does not yet provide a safe dedicated direct-share listing route. Search identifies owned, viewer, and editor results without inventing client-side access state.

## Local Setup

Prerequisites: Node.js 24+, pnpm 11+, Docker Desktop or a compatible Docker daemon.

```text
pnpm install
cp .env.example .env
docker compose up -d postgres redis minio
docker compose run --rm minio-init
pnpm db:generate
pnpm db:deploy
```

Configure a local web identity in `.env`:

```text
WEB_DEV_AUTH_USER=local-developer
WEB_DEV_AUTH_EMAIL=local-developer@nimbus.local
WEB_DEV_AUTH_NAME=Local Developer
```

The defaults use:

- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- MinIO API: `http://localhost:9000`
- MinIO console: `http://localhost:9001`

Start all application processes:

```text
pnpm dev
```

Or run them separately:

```text
pnpm dev:api
pnpm dev:worker
pnpm dev:web
```

`CORS_ORIGIN` must match the web origin when using another web port. `NEXT_PUBLIC_API_BASE_URL` configures the API origin. Dev-header identity is disabled by the web configuration in production; real production authentication remains deferred.

## Validation

```text
pnpm install
pnpm db:generate
docker compose up -d postgres redis minio
pnpm db:deploy
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm --filter @nimbus/web build
pnpm --filter @nimbus/web test
pnpm --filter @nimbus/web test:e2e
git diff --check
```

Real local storage/worker checks:

```text
pnpm smoke:minio:multipart
pnpm smoke:minio:thumbnail
pnpm smoke:minio:cleanup
pnpm smoke:metadata:indexing
```

## Security Model

- The API remains authoritative. UI action hiding is only a usability layer.
- `PermissionService` evaluates owner, active direct-share, and scoped public-link access at request time.
- Object buckets and keys stay private. The browser receives short-lived signed URLs only after authorization.
- Public-link tokens use 256-bit randomness; only SHA-256 hashes are persisted. The raw token is shown once.
- Signed URLs are ephemeral component state. They are never placed in local/session storage, audit metadata, job payloads, or application logs.
- Multipart resume storage contains only safe session ID and local file matching metadata.
- Next development request-path logging is disabled because public tokens are carried in `/public/:token`; the API logger separately redacts that path segment.

## Current Limits

- Local development uses configured dev headers. Auth.js production session integration is not implemented.
- Search covers metadata only, without OCR, content indexing, typo tolerance, or semantic search.
- Folder sharing, organizations, invitations, password-protected links, comments, and collaboration are not implemented.
- Thumbnails support JPEG, PNG, and WebP only; there is no full document preview.
- Delete is soft delete. Permanent deletion and normal-version retention policies are deferred.
- No API keys, SDK, CLI, webhooks, notifications, billing, desktop sync, or mobile app.
- Browser compatibility and load-test percentiles have not been claimed; validation is local Chromium functional evidence.

## Repository Map

```text
apps/web          Next.js console and browser upload client
apps/api          Express API, authorization, metadata, signed URLs
apps/worker       BullMQ processors and durable job reconciliation
packages/contracts Shared strict Zod schemas
packages/db       Prisma schema, migrations, PostgreSQL helpers
packages/storage  S3-compatible provider
packages/config   Typed environment validation
packages/logger   Structured logging and redaction
packages/auth     Dev/test authentication boundary
scripts           Real MinIO and database smoke evidence
```

Local engineering notes live in `docs/`, including the PRD, decisions, API flows, state machines, codemap, performance evidence, and implementation log.

## Roadmap

M1-M9 are complete locally. Deferred product/platform work is documented in `docs/FUTURE_WORK.md`; it is not partially scaffolded in the current product.

## License

MIT. See [LICENSE](LICENSE).
