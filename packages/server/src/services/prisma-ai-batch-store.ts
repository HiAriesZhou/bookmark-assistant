import type { AiBatchStore, AiGenerationBatchRecord } from './ai-batch-service';
import { prisma } from './userPrisma';

export class PrismaAiBatchStore implements AiBatchStore {
  async create(input: Omit<AiGenerationBatchRecord, 'id'>): Promise<AiGenerationBatchRecord> {
    // `requiresConfirmation` is a planning/UI convenience derived from status;
    // it is intentionally not persisted in the Prisma model.
    const { requiresConfirmation: _requiresConfirmation, ...data } = input;
    const value = await prisma.aiGenerationBatch.create({ data });
    return toRecord(value);
  }
  async confirm(id: string, userId: string): Promise<AiGenerationBatchRecord | undefined> {
    const value = await prisma.aiGenerationBatch.updateMany({ where: { id, userId, status: 'awaiting_confirmation' }, data: { status: 'queued', confirmedAt: new Date() } });
    return value.count ? this.find(id) : undefined;
  }
  async skip(id: string, userId: string): Promise<AiGenerationBatchRecord | undefined> {
    const value = await prisma.aiGenerationBatch.updateMany({ where: { id, userId, status: 'awaiting_confirmation' }, data: { status: 'skipped', skippedAt: new Date() } });
    return value.count ? this.find(id) : undefined;
  }
  /** A deliberate manual run is also the user's confirmation for every pending batch. */
  async confirmAllAwaiting(userId: string): Promise<number> {
    const pending = await prisma.aiGenerationBatch.findMany({
      where: { userId, status: 'awaiting_confirmation' },
      select: { id: true },
    });
    if (!pending.length) return 0;
    const batchIds = pending.map((batch) => batch.id);
    await prisma.$transaction([
      prisma.aiGenerationBatch.updateMany({
        where: { id: { in: batchIds }, userId, status: 'awaiting_confirmation' },
        data: { status: 'queued', confirmedAt: new Date() },
      }),
      prisma.aiGenerationTask.updateMany({
        where: { batchId: { in: batchIds }, status: 'awaiting_confirmation' },
        data: { status: 'queued' },
      }),
    ]);
    return batchIds.length;
  }
  private async find(id: string): Promise<AiGenerationBatchRecord | undefined> {
    const value = await prisma.aiGenerationBatch.findUnique({ where: { id } });
    return value ? toRecord(value) : undefined;
  }
}

function toRecord(value: { id: string; userId: string; dataSourceId: string | null; status: string; eligibleCount: number }): AiGenerationBatchRecord {
  return { id: value.id, userId: value.userId, dataSourceId: value.dataSourceId, eligibleCount: value.eligibleCount, status: value.status as AiGenerationBatchRecord['status'], requiresConfirmation: value.status === 'awaiting_confirmation' };
}
