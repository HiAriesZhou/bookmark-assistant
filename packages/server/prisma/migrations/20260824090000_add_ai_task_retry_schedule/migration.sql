ALTER TABLE "AiGenerationTask" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX "AiGenerationTask_status_nextAttemptAt_idx"
  ON "AiGenerationTask"("status", "nextAttemptAt");
