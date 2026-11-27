-- AlterTable
ALTER TABLE "InstagramAccount"
    ADD COLUMN "needsReconnect" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "lastTokenError" TEXT;
