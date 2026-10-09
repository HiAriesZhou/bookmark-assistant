import type { AiGenerationMode, AiProvider } from '@bookmark-assistant/types';
import { prisma } from './userPrisma';

export interface AiProviderControlRecord {
  status: string;
  singlePageEnabled: boolean;
  batchEnabled: boolean;
}

export interface AiProviderControlStore {
  get(provider: AiProvider): Promise<AiProviderControlRecord | undefined>;
}

export class PrismaAiProviderControlStore implements AiProviderControlStore {
  async get(provider: AiProvider): Promise<AiProviderControlRecord | undefined> {
    const record = await prisma.aiProviderControl.findUnique({
      where: { provider },
      select: { status: true, singlePageEnabled: true, batchEnabled: true },
    });
    return record || undefined;
  }
}

/** Missing rows are enabled so the control table can be introduced without seeding. */
export class AiProviderControlService {
  constructor(private readonly store: AiProviderControlStore) {}

  async isAllowed(provider: AiProvider, mode: AiGenerationMode | 'validation'): Promise<boolean> {
    const control = await this.store.get(provider);
    if (!control) return true;
    if (control.status !== 'enabled') return false;
    if (mode === 'single_page') return control.singlePageEnabled;
    if (mode === 'batch') return control.batchEnabled;
    return true;
  }
}
