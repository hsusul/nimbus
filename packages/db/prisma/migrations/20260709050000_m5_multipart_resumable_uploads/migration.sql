ALTER TABLE "upload_sessions"
ADD COLUMN "upload_type" TEXT NOT NULL DEFAULT 'single_part',
ADD COLUMN "multipart_upload_id" TEXT,
ADD COLUMN "chunk_size_bytes" BIGINT,
ADD COLUMN "received_bytes" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE "upload_chunks" (
    "id" TEXT NOT NULL,
    "upload_session_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "part_number" INTEGER NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT,
    "etag" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upload_chunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "upload_chunks_upload_session_id_part_number_key" ON "upload_chunks"("upload_session_id", "part_number");
CREATE INDEX "upload_sessions_upload_type_idx" ON "upload_sessions"("upload_type");
CREATE INDEX "upload_chunks_upload_session_id_idx" ON "upload_chunks"("upload_session_id");
CREATE INDEX "upload_chunks_upload_session_id_status_idx" ON "upload_chunks"("upload_session_id", "status");
CREATE INDEX "upload_chunks_owner_id_idx" ON "upload_chunks"("owner_id");

ALTER TABLE "upload_chunks" ADD CONSTRAINT "upload_chunks_upload_session_id_fkey" FOREIGN KEY ("upload_session_id") REFERENCES "upload_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "upload_chunks" ADD CONSTRAINT "upload_chunks_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
