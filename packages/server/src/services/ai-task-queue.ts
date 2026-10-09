import type { AiGenerationMode, AiGenerationStatus } from '@bookmark-assistant/types';
import { AI_PROVIDER_DEFAULT_MODELS } from './ai-provider-adapters';
import type { AiCredentialService, AiCredentialSummary } from './ai-credential-service';
import { AiCredentialNotFoundError } from './ai-credential-service';
import { AI_GENERATION_PROMPT_VERSION } from './ai-generation-prompt';

export interface AiGenerationTaskRecord {
  id: string;
  userId: string;
  knowledgeItemId: string;
  notionPageId: string;
  batchId?: string | null;
  sourceUrl: string | null;
  mode: AiGenerationMode;
  status: AiGenerationStatus;
  provider: string;
  model: string;
  promptVersion: string;
  credentialVersion: number;
  descriptionBaselineHash?: string | null;
}

export interface AiTaskStore {
  resolveInternalUserId(externalUserId: string): Promise<string | undefined>;
  findTask(userId: string, knowledgeItemId: string): Promise<AiGenerationTaskRecord | undefined>;
  createTask(task: Omit<AiGenerationTaskRecord, 'id'>): Promise<AiGenerationTaskRecord>;
  createTasks(tasks: Array<Omit<AiGenerationTaskRecord, 'id'>>): Promise<number>;
}

export interface EnqueueAiTaskInput {
  externalUserId: string;
  knowledgeItemId: string;
  notionPageId: string;
  sourceUrl?: string;
  batchId?: string;
  initialStatus?: AiGenerationStatus;
  descriptionBaselineHash?: string;
  mode: AiGenerationMode;
}

export type EnqueueAiTaskResult =
  | { created: true; task: AiGenerationTaskRecord }
  | { created: false; task: AiGenerationTaskRecord }
  | { created: false; reason: 'credential_required' | 'user_not_found' };

export interface EnqueueAiBatchTasksInput {
  externalUserId: string;
  batchId: string;
  initialStatus: AiGenerationStatus;
  /** Reuse the credential summary already validated by the sync route. */
  credential?: AiCredentialSummary;
  items: Array<{
    knowledgeItemId: string;
    notionPageId: string;
    sourceUrl?: string;
    descriptionBaselineHash?: string;
  }>;
}

export type EnqueueAiBatchTasksResult =
  | { created: number; skipped: number }
  | { created: 0; skipped: number; reason: 'credential_required' | 'user_not_found' };

/**
 * Creates one durable task per user and knowledge item. It deliberately does not
 * receive page bodies, prompts, or model output, so the queue remains privacy-safe.
 */
export class AiTaskQueue {
  constructor(
    private readonly store: AiTaskStore,
    private readonly credentials: Pick<AiCredentialService, 'getCredentialSummary'>
  ) {}

  async enqueue(input: EnqueueAiTaskInput): Promise<EnqueueAiTaskResult> {
    const userId = await this.store.resolveInternalUserId(input.externalUserId);
    if (!userId) return { created: false, reason: 'user_not_found' };

    const existing = await this.store.findTask(userId, input.knowledgeItemId);
    if (existing) return { created: false, task: existing };

    const credential = await this.getVerifiedCredential(input.externalUserId);
    if (!credential) return { created: false, reason: 'credential_required' };

    const task = await this.store.createTask({
      userId,
      knowledgeItemId: input.knowledgeItemId,
      notionPageId: input.notionPageId,
      batchId: input.batchId || null,
      sourceUrl: input.sourceUrl || null,
      mode: input.mode,
      status: input.initialStatus || 'queued',
      provider: credential.provider,
      model: AI_PROVIDER_DEFAULT_MODELS[credential.provider],
      promptVersion: AI_GENERATION_PROMPT_VERSION,
      credentialVersion: credential.credentialVersion,
      descriptionBaselineHash: input.descriptionBaselineHash || null,
    });
    return { created: true, task };
  }

  /**
   * Persist a batch's task rows in one database operation. This keeps large
   * bookmark syncs bounded and relies on the database uniqueness constraint
   * rather than one find/create round trip per item.
   */
  async enqueueBatch(input: EnqueueAiBatchTasksInput): Promise<EnqueueAiBatchTasksResult> {
    const userId = await this.store.resolveInternalUserId(input.externalUserId);
    if (!userId) return { created: 0, skipped: input.items.length, reason: 'user_not_found' };

    const credential =
      input.credential?.status === 'verified'
        ? input.credential
        : await this.getVerifiedCredential(input.externalUserId);
    if (!credential) {
      return { created: 0, skipped: input.items.length, reason: 'credential_required' };
    }

    const tasks = input.items.map((item) => ({
      userId,
      knowledgeItemId: item.knowledgeItemId,
      notionPageId: item.notionPageId,
      batchId: input.batchId,
      sourceUrl: item.sourceUrl || null,
      mode: 'batch' as const,
      status: input.initialStatus,
      provider: credential.provider,
      model: AI_PROVIDER_DEFAULT_MODELS[credential.provider],
      promptVersion: AI_GENERATION_PROMPT_VERSION,
      credentialVersion: credential.credentialVersion,
      descriptionBaselineHash: item.descriptionBaselineHash || null,
    }));
    const created = tasks.length ? await this.store.createTasks(tasks) : 0;
    return { created, skipped: tasks.length - created };
  }

  private async getVerifiedCredential(
    externalUserId: string
  ): Promise<AiCredentialSummary | undefined> {
    try {
      const credential = await this.credentials.getCredentialSummary(externalUserId);
      return credential?.status === 'verified' ? credential : undefined;
    } catch (error) {
      if (error instanceof AiCredentialNotFoundError) return undefined;
      throw error;
    }
  }
}
