ALTER TABLE "upload_sessions"
ADD COLUMN "correlation_id" TEXT;

CREATE TABLE "background_jobs" (
    "id" TEXT NOT NULL,
    "queue_name" TEXT NOT NULL,
    "bullmq_job_id" TEXT,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "last_error" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "upload_sessions_correlation_id_idx" ON "upload_sessions"("correlation_id");
CREATE INDEX "background_jobs_queue_name_status_idx" ON "background_jobs"("queue_name", "status");
CREATE INDEX "background_jobs_resource_type_resource_id_idx" ON "background_jobs"("resource_type", "resource_id");
CREATE INDEX "background_jobs_correlation_id_idx" ON "background_jobs"("correlation_id");
CREATE INDEX "background_jobs_created_at_idx" ON "background_jobs"("created_at");

ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "upload_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
