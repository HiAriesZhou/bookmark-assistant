-- CreateTable
CREATE TABLE "User" (
    "user_id" TEXT NOT NULL,
    "notion_access_token" TEXT NOT NULL,
    "notion_refresh_token" TEXT,
    "notion_workspace_id" TEXT,
    "bot_id" TEXT,
    "duplicated_template_id" TEXT,
    "notion_database_id" TEXT,
    "notion_data_source_id" TEXT,
    "template_database_id" TEXT,
    "databases" JSONB,
    "last_activity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("user_id")
);
