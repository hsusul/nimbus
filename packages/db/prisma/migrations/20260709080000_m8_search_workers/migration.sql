-- Generalize durable background jobs beyond upload sessions.
ALTER TABLE "background_jobs"
ADD COLUMN "owner_id" TEXT,
ADD COLUMN "failure_code" TEXT,
ADD COLUMN "dedupe_key" TEXT,
ADD COLUMN "started_at" TIMESTAMP(3);

UPDATE "background_jobs" AS job
SET "owner_id" = session."owner_id"
FROM "upload_sessions" AS session
WHERE job."resource_type" = 'upload_session'
  AND job."resource_id" = session."id";

ALTER TABLE "background_jobs"
ALTER COLUMN "owner_id" SET NOT NULL,
DROP CONSTRAINT "background_jobs_resource_id_fkey";

ALTER TABLE "background_jobs"
ADD CONSTRAINT "background_jobs_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "background_jobs_owner_id_created_at_idx"
ON "background_jobs"("owner_id", "created_at");

CREATE INDEX "background_jobs_owner_id_queue_name_status_created_at_idx"
ON "background_jobs"("owner_id", "queue_name", "status", "created_at");

CREATE UNIQUE INDEX "background_jobs_dedupe_key_key"
ON "background_jobs"("dedupe_key");

-- Keep source metadata immediately searchable and derive indexed vectors in PostgreSQL.
ALTER TABLE "files"
ADD COLUMN "search_document" TEXT NOT NULL DEFAULT '',
ADD COLUMN "search_indexed_at" TIMESTAMP(3),
ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "search_document")) STORED;

UPDATE "files"
SET "search_document" = trim(concat_ws(' ', "name", "extension", "mime_type"));

ALTER TABLE "folders"
ADD COLUMN "search_document" TEXT NOT NULL DEFAULT '',
ADD COLUMN "search_indexed_at" TIMESTAMP(3),
ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "search_document")) STORED;

UPDATE "folders"
SET "search_document" = "name";

CREATE INDEX "files_search_vector_idx" ON "files" USING GIN ("search_vector");
CREATE INDEX "folders_search_vector_idx" ON "folders" USING GIN ("search_vector");
CREATE INDEX "files_normalized_name_prefix_idx" ON "files" ("normalized_name" text_pattern_ops);
CREATE INDEX "folders_normalized_name_prefix_idx" ON "folders" ("normalized_name" text_pattern_ops);
CREATE INDEX "shares_search_grantee_file_idx"
ON "shares"("grantee_user_id", "resource_id", "expires_at")
WHERE "resource_type" = 'file' AND "revoked_at" IS NULL;

-- One deterministic derived thumbnail record per immutable file version.
CREATE TABLE "thumbnails" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "file_version_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "bucket" TEXT,
    "object_key" TEXT,
    "mime_type" TEXT NOT NULL DEFAULT 'image/webp',
    "width" INTEGER,
    "height" INTEGER,
    "size_bytes" BIGINT,
    "failure_code" TEXT,
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "thumbnails_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "thumbnails_file_version_id_key" ON "thumbnails"("file_version_id");
CREATE INDEX "thumbnails_owner_id_status_idx" ON "thumbnails"("owner_id", "status");
CREATE INDEX "thumbnails_file_id_status_idx" ON "thumbnails"("file_id", "status");
CREATE INDEX "thumbnails_status_created_at_idx" ON "thumbnails"("status", "created_at");

ALTER TABLE "thumbnails"
ADD CONSTRAINT "thumbnails_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "thumbnails"
ADD CONSTRAINT "thumbnails_file_id_fkey"
FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "thumbnails"
ADD CONSTRAINT "thumbnails_file_version_id_fkey"
FOREIGN KEY ("file_version_id") REFERENCES "file_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "thumbnails"
ADD CONSTRAINT "thumbnails_status_check"
CHECK ("status" IN ('pending', 'processing', 'complete', 'failed', 'skipped'));
