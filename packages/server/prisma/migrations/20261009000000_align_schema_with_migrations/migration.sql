-- Align migration history with schema.prisma. Every statement is idempotent so it is
-- safe on databases that already received these changes outside the migration history.

-- The initial migration created these columns as NOT NULL; the schema has always
-- declared them optional (for example, Paddle webhooks may create a user by email
-- before Notion is connected).
ALTER TABLE "User" ALTER COLUMN "notionUserId" DROP NOT NULL,
ALTER COLUMN "notionAccessToken" DROP NOT NULL;

-- The description cache model was never captured in a migration.
CREATE TABLE IF NOT EXISTS "description_cache" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),

    CONSTRAINT "description_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "description_cache_url_key" ON "description_cache"("url");
CREATE INDEX IF NOT EXISTS "description_cache_url_idx" ON "description_cache"("url");
CREATE INDEX IF NOT EXISTS "description_cache_expiresAt_idx" ON "description_cache"("expiresAt");
