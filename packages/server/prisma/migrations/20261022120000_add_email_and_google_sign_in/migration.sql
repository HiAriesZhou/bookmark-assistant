-- Additive sign-in fields. Existing columns and tables are unchanged.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN "googleSub" TEXT;

CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

CREATE TABLE "EmailLoginCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLoginCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailLoginCode_email_createdAt_idx" ON "EmailLoginCode"("email", "createdAt");
