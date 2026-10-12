-- Accounts can sign in with Google independently of the optional Notion destination.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleSub" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_googleSub_key" ON "User"("googleSub");
