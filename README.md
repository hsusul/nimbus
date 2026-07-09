# Nimbus

Nimbus is an API-first object storage and file collaboration platform for developers. It is being built as an open-source backend systems project that demonstrates production-grade storage architecture: PostgreSQL metadata, S3-compatible object storage, signed URLs, BullMQ workers, resumable uploads, immutable file versions, permissions, audit logs, and observability.

Current status: **M1 Foundation**. The repository currently contains the runnable monorepo foundation, minimal web console, Express API skeleton, worker skeleton, Prisma `User` model, typed config, structured logging, dev/test auth helper, Docker Compose services, and M1 tests. Product features such as folders, files, uploads, sharing, search, and versioning are intentionally not implemented yet.

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

M1 API endpoints:

- `GET /health`
- `GET /ready`
- `GET /api/v1/me`

Dev/test auth for `/api/v1/me` uses headers:

```text
x-nimbus-dev-user: test-user
x-nimbus-dev-email: test@example.com
```

## Documentation

- Product requirements: [docs/PRD.md](docs/PRD.md)
- Milestone roadmap: [docs/MILESTONE_CHECKLIST.md](docs/MILESTONE_CHECKLIST.md)
- Implementation log: [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md)
- Code map: [docs/CODEMAP.md](docs/CODEMAP.md)
- Rebuild guide: [docs/BUILD_FROM_SCRATCH.md](docs/BUILD_FROM_SCRATCH.md)

## Roadmap

See [docs/MILESTONE_CHECKLIST.md](docs/MILESTONE_CHECKLIST.md). M1 is the foundation milestone. M2 begins folders and metadata, but it has not been implemented yet.

## License

MIT. See [LICENSE](LICENSE).
