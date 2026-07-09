# Nimbus

Nimbus is an API-first object storage and file collaboration platform for developers. It is being built as an open-source backend systems project that demonstrates production-grade storage architecture: PostgreSQL metadata, S3-compatible object storage, signed URLs, BullMQ workers, resumable uploads, immutable file versions, permissions, audit logs, and observability.

Current status: **M2 Metadata Core**. The repository currently contains the runnable monorepo foundation, minimal web console, Express API, worker skeleton, Prisma `User`/`Folder`/`File`/`AuditLog` models, typed config, structured logging, dev/test auth helper, Docker Compose services, folder and file metadata APIs, soft delete/restore, cursor pagination, folder cycle prevention, audit logs, and M1/M2 tests. Object storage, uploads, signed URLs, file versions, sharing, search, thumbnails, and real file byte handling are intentionally not implemented yet.

## Architecture

```text
apps/web      Next.js web console
apps/api      Express API service
apps/worker   BullMQ worker skeleton

packages/db        Prisma and PostgreSQL metadata
packages/config    Typed environment validation
packages/logger    Structured logging and redaction
packages/auth      Auth skeleton and dev/test user helper
packages/contracts Shared API schemas
packages/storage   Storage package boundary for later milestones
```

Local infrastructure is provided by Docker Compose:

- PostgreSQL for metadata.
- Redis for queues and readiness checks.
- MinIO for future S3-compatible local object storage.

## Tech Stack

- TypeScript
- Next.js
- Express
- PostgreSQL
- Prisma
- Redis
- BullMQ
- MinIO
- Vitest
- Docker Compose

## Local Setup

Prerequisites:

- Node.js 24+
- pnpm 11+
- Docker Desktop or a running Docker daemon

Install dependencies:

```text
pnpm install
```

Start local services:

```text
docker compose up -d postgres redis minio
```

Generate Prisma Client:

```text
pnpm db:generate
```

Apply database migrations:

```text
pnpm db:deploy
```

Run validation:

```text
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm --filter @nimbus/web build
```

Useful development commands:

```text
pnpm dev:api
pnpm dev:web
pnpm dev:worker
```

Implemented API endpoints:

- `GET /health`
- `GET /ready`
- `GET /api/v1/me`
- `POST /api/v1/folders`
- `GET /api/v1/folders/:folderId`
- `GET /api/v1/folders/:folderId/children`
- `PATCH /api/v1/folders/:folderId`
- `POST /api/v1/folders/:folderId/move`
- `DELETE /api/v1/folders/:folderId`
- `POST /api/v1/folders/:folderId/restore`
- `GET /api/v1/files`
- `GET /api/v1/files/:fileId`
- `POST /api/v1/files`
- `PATCH /api/v1/files/:fileId`
- `POST /api/v1/files/:fileId/move`
- `DELETE /api/v1/files/:fileId`
- `POST /api/v1/files/:fileId/restore`
- `GET /api/v1/audit-logs`

Dev/test auth for `/api/v1/me` uses headers:

```text
x-nimbus-dev-user: test-user
x-nimbus-dev-email: test@example.com
```

## Documentation

Detailed product, architecture, implementation, and interview-prep notes live in the local `docs/` directory. That directory is intentionally ignored for the public GitHub repo.

## Roadmap

See the local `docs/MILESTONE_CHECKLIST.md` file. M1 and M2 are complete locally; M3 begins object storage and signed URLs, but it has not been implemented yet.

## License

MIT. See [LICENSE](LICENSE).
