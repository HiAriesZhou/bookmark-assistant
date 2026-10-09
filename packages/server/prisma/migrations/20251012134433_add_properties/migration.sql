-- AlterTable
ALTER TABLE "User" ADD COLUMN     "connected" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "last_disconnected_at" TIMESTAMP(3);
