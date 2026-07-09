# Contributing to Nimbus

Nimbus is currently in M1 Foundation. Keep changes scoped to the active milestone unless the milestone checklist says otherwise.

## Local Setup

Install dependencies:

```text
pnpm install
```

Start local infrastructure:

```text
docker compose up -d postgres redis minio
```

Generate Prisma Client and apply migrations:

```text
pnpm db:generate
pnpm db:deploy
```

Run services:

```text
pnpm dev:api
pnpm dev:web
pnpm dev:worker
```

## Validation Commands

Run these before opening a pull request:

```text
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm --filter @nimbus/web build
```

## Documentation Requirements

Update docs alongside code. For each milestone or implementation slice, update:

- `docs/IMPLEMENTATION_LOG.md`
- `docs/MILESTONE_CHECKLIST.md`
- `docs/CODEMAP.md` when file ownership changes
- `docs/ARCHITECTURE_NOTES.md` when subsystem boundaries change
- `docs/DATABASE_NOTES.md` when schema changes
- `docs/COMMON_BUGS.md` only for real observed bugs

Implementation log entries must include exact files changed, routes added, database changes, tests added, commands run, validation results, unresolved issues, and next steps.

## Scope Discipline

Do not implement future milestone features early. In particular, M1 does not include folders, files, uploads, sharing, search, or versioning.

## Security

Do not commit secrets. Keep real credentials in local `.env` files only. `.env.example` must contain safe local placeholders.
