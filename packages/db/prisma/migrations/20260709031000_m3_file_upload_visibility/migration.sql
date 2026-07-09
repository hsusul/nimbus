DROP INDEX IF EXISTS "files_active_sibling_name_key";

CREATE UNIQUE INDEX "files_active_sibling_name_key"
ON "files"("owner_id", "folder_id", "normalized_name")
WHERE "deleted_at" IS NULL AND "status" IN ('active', 'uploading');
