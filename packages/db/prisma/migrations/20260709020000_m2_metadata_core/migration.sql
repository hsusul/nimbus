CREATE TABLE "folders" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "parent_folder_id" TEXT,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "path_cache" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "folder_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "extension" TEXT,
    "mime_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "target_user_id" TEXT,
    "request_id" TEXT,
    "correlation_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "folders_owner_id_parent_folder_id_idx" ON "folders"("owner_id", "parent_folder_id");
CREATE INDEX "folders_owner_id_deleted_at_idx" ON "folders"("owner_id", "deleted_at");
CREATE INDEX "folders_parent_folder_id_idx" ON "folders"("parent_folder_id");
CREATE UNIQUE INDEX "folders_active_root_owner_key" ON "folders"("owner_id") WHERE "parent_folder_id" IS NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "folders_active_sibling_name_key" ON "folders"("owner_id", "parent_folder_id", "normalized_name") WHERE "parent_folder_id" IS NOT NULL AND "deleted_at" IS NULL;

CREATE INDEX "files_owner_id_folder_id_idx" ON "files"("owner_id", "folder_id");
CREATE INDEX "files_owner_id_deleted_at_idx" ON "files"("owner_id", "deleted_at");
CREATE INDEX "files_folder_id_idx" ON "files"("folder_id");
CREATE UNIQUE INDEX "files_active_sibling_name_key" ON "files"("owner_id", "folder_id", "normalized_name") WHERE "deleted_at" IS NULL;

CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");
CREATE INDEX "audit_logs_resource_type_resource_id_created_at_idx" ON "audit_logs"("resource_type", "resource_id", "created_at");
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");

ALTER TABLE "folders" ADD CONSTRAINT "folders_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_folder_id_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
