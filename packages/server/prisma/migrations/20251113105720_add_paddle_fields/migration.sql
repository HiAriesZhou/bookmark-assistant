-- Add Paddle payment fields to User table

-- Add email field
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT;

-- Add Paddle payment fields
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "paddleCustomerId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "paddleSubscriptionId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "subscriptionStatus" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "nextBilledAt" TIMESTAMP(3);

-- Create unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "User_paddleCustomerId_key" ON "User"("paddleCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_paddleSubscriptionId_key" ON "User"("paddleSubscriptionId");

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "User_paddleCustomerId_idx" ON "User"("paddleCustomerId");
CREATE INDEX IF NOT EXISTS "User_paddleSubscriptionId_idx" ON "User"("paddleSubscriptionId");
CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email");
