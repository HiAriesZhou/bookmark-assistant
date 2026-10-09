-- Foundation tables for user-provided AI summary and tag generation.
-- These tables intentionally do not include webpage bodies, prompts, raw model
-- responses, or plaintext provider credentials.

CREATE TABLE "AiProviderCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptionScheme" TEXT NOT NULL DEFAULT 'aes-256-gcm',
    "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "initializationVector" TEXT NOT NULL,
    "authenticationTag" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "keyLastFour" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'verified',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "singlePageEnabled" BOOLEAN NOT NULL DEFAULT true,
    "batchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "excludedHosts" JSONB,
    "descriptionPropertyId" TEXT,
    "tagsPropertyId" TEXT,
    "validatedDataSourceId" TEXT,
    "schemaStatus" TEXT NOT NULL DEFAULT 'not_configured',
    "schemaValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiGenerationBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dataSourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'awaiting_confirmation',
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGenerationBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiGenerationTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "batchId" TEXT,
    "knowledgeItemId" TEXT NOT NULL,
    "notionPageId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "reasonCode" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "descriptionBaselineHash" TEXT,
    "tagsBaselineHash" TEXT,
    "expectedResultHash" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGenerationTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiGenerationDiagnostic" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGenerationDiagnostic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiProviderControl" (
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "singlePageEnabled" BOOLEAN NOT NULL DEFAULT true,
    "batchEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pausedReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderControl_pkey" PRIMARY KEY ("provider")
);

CREATE UNIQUE INDEX "AiProviderCredential_userId_key" ON "AiProviderCredential"("userId");
CREATE UNIQUE INDEX "AiSettings_userId_key" ON "AiSettings"("userId");
CREATE UNIQUE INDEX "AiGenerationTask_userId_knowledgeItemId_key" ON "AiGenerationTask"("userId", "knowledgeItemId");
CREATE INDEX "AiGenerationBatch_userId_status_idx" ON "AiGenerationBatch"("userId", "status");
CREATE INDEX "AiGenerationTask_status_leaseExpiresAt_idx" ON "AiGenerationTask"("status", "leaseExpiresAt");
CREATE INDEX "AiGenerationTask_batchId_idx" ON "AiGenerationTask"("batchId");
CREATE INDEX "AiGenerationTask_userId_status_idx" ON "AiGenerationTask"("userId", "status");
CREATE INDEX "AiGenerationDiagnostic_expiresAt_idx" ON "AiGenerationDiagnostic"("expiresAt");
CREATE INDEX "AiGenerationDiagnostic_taskId_idx" ON "AiGenerationDiagnostic"("taskId");

ALTER TABLE "AiProviderCredential" ADD CONSTRAINT "AiProviderCredential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiGenerationBatch" ADD CONSTRAINT "AiGenerationBatch_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiGenerationTask" ADD CONSTRAINT "AiGenerationTask_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiGenerationTask" ADD CONSTRAINT "AiGenerationTask_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "AiGenerationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiGenerationDiagnostic" ADD CONSTRAINT "AiGenerationDiagnostic_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "AiGenerationTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
