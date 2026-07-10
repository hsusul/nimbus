-- CreateTable
CREATE TABLE "shares" (
    "id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "grantee_user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_links" (
    "id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "created_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shares_resource_type_resource_id_idx" ON "shares"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "shares_grantee_user_id_revoked_at_idx" ON "shares"("grantee_user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "shares_created_by_id_revoked_at_idx" ON "shares"("created_by_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "shares_active_grant_key" ON "shares"("resource_type", "resource_id", "grantee_user_id") WHERE "revoked_at" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_hash_key" ON "share_links"("token_hash");

-- CreateIndex
CREATE INDEX "share_links_resource_type_resource_id_idx" ON "share_links"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "share_links_created_by_id_revoked_at_idx" ON "share_links"("created_by_id", "revoked_at");

-- CreateIndex
CREATE INDEX "share_links_expires_at_idx" ON "share_links"("expires_at");

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_grantee_user_id_fkey" FOREIGN KEY ("grantee_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
