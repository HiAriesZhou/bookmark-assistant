-- Add subscription tracking fields for Paddle integration
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "paddleSubscriptionId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "purchaseType" TEXT;

-- Create unique index for paddleSubscriptionId
CREATE UNIQUE INDEX IF NOT EXISTS "User_paddleSubscriptionId_key" ON "User"("paddleSubscriptionId");

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS "User_paddleSubscriptionId_idx" ON "User"("paddleSubscriptionId");
CREATE INDEX IF NOT EXISTS "User_purchaseType_idx" ON "User"("purchaseType");
