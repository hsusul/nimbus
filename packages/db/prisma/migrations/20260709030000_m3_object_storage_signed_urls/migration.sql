ALTER TABLE "files"
ADD COLUMN "content_hash" TEXT,
ADD COLUMN "current_version_id" TEXT;

CREATE TABLE "upload_sessions" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "target_folder_id" TEXT NOT NULL,
    "target_file_id" TEXT,
    "planned_version_id" TEXT NOT NULL,
    "upload_mode" TEXT NOT NULL DEFAULT 'new_file',
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "total_size_bytes" BIGINT NOT NULL,
    "expected_sha256" TEXT,
    "final_object_key" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "file_versions" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "storage_provider" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT,
    "etag" TEXT,
    "mime_type" TEXT NOT NULL,
    "upload_session_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "processing_status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "files_current_version_id_idx" ON "files"("current_version_id");

CREATE INDEX "upload_sessions_owner_id_status_idx" ON "upload_sessions"("owner_id", "status");
CREATE INDEX "upload_sessions_target_folder_id_idx" ON "upload_sessions"("target_folder_id");
CREATE INDEX "upload_sessions_target_file_id_idx" ON "upload_sessions"("target_file_id");
CREATE INDEX "upload_sessions_expires_at_idx" ON "upload_sessions"("expires_at");
CREATE UNIQUE INDEX "upload_sessions_planned_version_id_key" ON "upload_sessions"("planned_version_id");

CREATE UNIQUE INDEX "file_versions_upload_session_id_key" ON "file_versions"("upload_session_id");
CREATE UNIQUE INDEX "file_versions_file_id_version_number_key" ON "file_versions"("file_id", "version_number");
CREATE INDEX "file_versions_file_id_created_at_idx" ON "file_versions"("file_id", "created_at");
CREATE INDEX "file_versions_created_by_id_idx" ON "file_versions"("created_by_id");
CREATE INDEX "file_versions_processing_status_idx" ON "file_versions"("processing_status");

ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_target_folder_id_fkey" FOREIGN KEY ("target_folder_id") REFERENCES "folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_target_file_id_fkey" FOREIGN KEY ("target_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_upload_session_id_fkey" FOREIGN KEY ("upload_session_id") REFERENCES "upload_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "files" ADD CONSTRAINT "files_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "file_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
