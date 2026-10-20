import { config } from '../config';
import { AiCredentialService } from '../services/ai-credential-service';
import { createCredentialCipher } from '../services/credential-cipher';
import { AiSettingsService } from '../services/ai-settings-service';
import { AiTaskExecutor } from '../services/ai-task-executor';
import { AiTaskWorker, type AiTaskRunSummary } from '../services/ai-task-worker';
import { createAiProviderAdapter } from '../services/ai-provider-adapters';
import { PublicPageFetcher } from '../services/public-page-fetcher';
import { PrismaAiCredentialStore } from '../services/prisma-ai-credential-store';
import { PrismaAiSettingsStore } from '../services/prisma-ai-settings-store';
import { PrismaAiTaskStore } from '../services/prisma-ai-task-store';
import { notionService } from '../services/notion';
import { userPrisma } from '../services/userPrisma';
import { AiDiagnosticsService } from '../services/ai-diagnostics-service';
import {
  AiProviderControlService,
  PrismaAiProviderControlStore,
} from '../services/ai-provider-control-service';
import { PrismaPublicPageDomainLimiter } from '../services/prisma-public-page-domain-limiter';

function createWorker(): AiTaskWorker | undefined {
  if (!config.aiCredentialEncryption.available) return undefined;
  const taskStore = new PrismaAiTaskStore();
  const credentials = new AiCredentialService(
    new PrismaAiCredentialStore(),
    createCredentialCipher(config.aiCredentialEncryption)
  );
  const settings = new AiSettingsService(new PrismaAiSettingsStore());
  const providerControl = new AiProviderControlService(new PrismaAiProviderControlStore());
  const executor = new AiTaskExecutor({
    store: taskStore,
    credentials,
    notion: notionService,
    fetcher: new PublicPageFetcher(new PrismaPublicPageDomainLimiter()),
    providerFor: (provider, model) => createAiProviderAdapter(provider, fetch, model),
    providerControl,
    diagnostics: new AiDiagnosticsService(),
  });
  return new AiTaskWorker({
    store: taskStore,
    resolveContext: async (userId) => {
      const [user, aiSettings] = await Promise.all([userPrisma.find(userId), settings.get(userId)]);
      return user?.notionAccessToken && aiSettings?.properties
        ? {
            accessToken: user.notionAccessToken,
            settings: aiSettings.properties,
            dataSourceId: user.notionDataSourceId || undefined,
          }
        : undefined;
    },
    execute: (task, context) => executor.execute(task, context),
  });
}

/**
 * Processes a small user-owned batch. The caller is responsible for authenticating
 * the user; the database claim remains the concurrency boundary.
 */
export async function runAiTasksForUserWithSummary(
  userId: string,
  maxTasks = 2
): Promise<AiTaskRunSummary> {
  const worker = createWorker();
  return worker
    ? worker.runForUserWithSummary(userId, maxTasks)
    : { claimed: 0, succeeded: 0, skipped: 0, failed: 0, needsAction: 0 };
}
