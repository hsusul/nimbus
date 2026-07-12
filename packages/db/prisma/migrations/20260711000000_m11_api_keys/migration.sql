CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");
CREATE INDEX "api_keys_owner_user_id_status_idx" ON "api_keys"("owner_user_id", "status");
CREATE INDEX "api_keys_expires_at_idx" ON "api_keys"("expires_at");
CREATE UNIQUE INDEX "api_keys_owner_active_name_key"
  ON "api_keys"("owner_user_id", lower("name"))
  WHERE "status" = 'active' AND "revoked_at" IS NULL;

ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
