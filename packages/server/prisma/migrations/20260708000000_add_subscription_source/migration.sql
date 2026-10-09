-- Add non-Paddle Pro entitlement metadata.
-- Nullable fields keep existing free and Paddle-paid users compatible.
ALTER TABLE "User" ADD COLUMN "subscriptionSource" TEXT;
ALTER TABLE "User" ADD COLUMN "expiresAt" TIMESTAMP(3);
