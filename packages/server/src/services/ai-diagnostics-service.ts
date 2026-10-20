import { prisma } from './userPrisma';

export interface AiDiagnosticInput {
  providerRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  errorCode?: string;
  retryCount?: number;
}

export class AiDiagnosticsService {
  async record(taskId: string, input: AiDiagnosticInput): Promise<void> {
    await prisma.aiGenerationDiagnostic.create({
      data: {
        taskId,
        providerRequestId: input.providerRequestId || null,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        durationMs: input.durationMs,
        errorCode: input.errorCode || null,
        retryCount: input.retryCount || 0,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }
}
