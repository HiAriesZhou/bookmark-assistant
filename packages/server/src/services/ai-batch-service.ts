import { planAiBatch, type AiBatchPlan } from './ai-batch-planner';

export type AiGenerationBatchRecord = {
  id: string;
  userId: string;
  dataSourceId?: string | null;
  eligibleCount: number;
  status: 'queued' | 'awaiting_confirmation' | 'skipped';
  requiresConfirmation: boolean;
};
export interface AiBatchStore {
  create(input: Omit<AiGenerationBatchRecord, 'id'>): Promise<AiGenerationBatchRecord>;
  confirm(id: string, userId: string): Promise<AiGenerationBatchRecord | undefined>;
  skip(id: string, userId: string): Promise<AiGenerationBatchRecord | undefined>;
}

export class AiBatchService {
  constructor(private readonly store: AiBatchStore) {}
  create(userId: string, dataSourceId: string | null | undefined, eligibleCount: number) {
    const plan = planAiBatch(eligibleCount);
    return this.store.create({ userId, dataSourceId, ...plan });
  }
  confirm(id: string, userId: string) { return this.store.confirm(id, userId); }
  skip(id: string, userId: string) { return this.store.skip(id, userId); }
}
