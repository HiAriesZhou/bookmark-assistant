-- Rename columns
ALTER TABLE "User" RENAME COLUMN "user_id" TO "notionUserId";
ALTER TABLE "User" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "User" RENAME COLUMN "updated_at" TO "updatedAt";
ALTER TABLE "User" RENAME COLUMN "last_activity" TO "lastActivity";
ALTER TABLE "User" RENAME COLUMN "notion_access_token" TO "notionAccessToken";
ALTER TABLE "User" RENAME COLUMN "notion_refresh_token" TO "notionRefreshToken";
ALTER TABLE "User" RENAME COLUMN "notion_data_source_id" TO "notionDataSourceId";
ALTER TABLE "User" RENAME COLUMN "notion_database_id" TO "notionDatabaseId";
ALTER TABLE "User" RENAME COLUMN "template_database_id" TO "templateDatabaseId";
ALTER TABLE "User" RENAME COLUMN "notion_workspace_id" TO "notionWorkspaceId";
ALTER TABLE "User" RENAME COLUMN "bot_id" TO "botId";
ALTER TABLE "User" RENAME COLUMN "duplicated_template_id" TO "duplicatedTemplateId";

-- Drop unused columns
ALTER TABLE "User" DROP COLUMN "connected";
ALTER TABLE "User" DROP COLUMN "last_disconnected_at";
ALTER TABLE "User" DROP COLUMN "nextBilledAt";
ALTER TABLE "User" DROP COLUMN "paddleSubscriptionId";
ALTER TABLE "User" DROP COLUMN "subscriptionStatus";

-- Drop old PK
ALTER TABLE "User" DROP CONSTRAINT "User_pkey";

-- Add new columns
ALTER TABLE "User" ADD COLUMN "id" TEXT;
ALTER TABLE "User" ADD COLUMN "licenseKey" TEXT;

-- Backfill ID
UPDATE "User" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;

-- Backfill Email
UPDATE "User" SET "email" = 'user_' || "id" || '@example.com' WHERE "email" IS NULL;

-- Apply constraints
ALTER TABLE "User" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");

ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "User" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "lastActivity" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "lastActivity" SET DEFAULT CURRENT_TIMESTAMP;

-- Indexes
CREATE UNIQUE INDEX "User_notionUserId_key" ON "User"("notionUserId");
CREATE INDEX "User_notionUserId_idx" ON "User"("notionUserId");
