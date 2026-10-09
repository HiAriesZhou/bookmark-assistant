import type { AiGenerationReasonCode, AiGenerationStatus } from '@bookmark-assistant/types';
import type { ActiveAiProviderCredential } from './ai-credential-service';
import { AiProviderGenerationError, type AiProviderAdapter } from './ai-provider-adapters';
import {
  AiGenerationOutputError,
  buildAiGenerationPrompt,
  buildAiSummaryCompressionPrompt,
  canonicalizeGeneratedTags,
  parseAiModelOutput,
  selectSufficientAiContent,
} from './ai-generation-prompt';
import type { AiGenerationTaskRecord } from './ai-task-queue';
import {
  NotionAiWriteError,
  doesNotionPageMatchAiOutput,
  prepareNotionAiWrite,
  type NotionAiPropertySettings,
  type NotionPageForAi,
} from './notion-ai-writer';
import { PublicPageFetchError, type PublicPageFetcher } from './public-page-fetcher';
import { isAiSourceDisallowed } from './ai-settings-service';
import { isAiProvider } from './ai-provider';

export interface ExecutableAiTask extends AiGenerationTaskRecord {
  descriptionBaselineHash?: string | null;
  leaseToken?: string | null;
  attemptCount?: number;
  providerRetryAfterMs?: number;
}

export interface AiTaskExecutionStore {
  complete(
    taskId: string,
    leaseToken: string,
    status: AiGenerationStatus,
    reasonCode?: AiGenerationReasonCode
  ): Promise<boolean>;
  hasActiveLease(taskId: string, leaseToken: string): Promise<boolean>;
  stopUserTasksForProviderError(
    userId: string,
    provider: string,
    credentialVersion: number,
    reasonCode: Extract<AiGenerationReasonCode, 'needs_action_invalid_api_key' | 'needs_action_insufficient_quota' | 'needs_action_model_access'>
  ): Promise<void>;
}

export interface AiTaskExecutionNotionClient {
  getPage(pageId: string, accessToken: string): Promise<NotionPageForAi>;
  updatePage(pageId: string, properties: Record<string, unknown>, accessToken: string): Promise<void>;
  getAiTagCandidates?(dataSourceId: string, accessToken: string, tagsPropertyId: string): Promise<string[]>;
}

export interface AiTaskExecutionContext {
  accessToken: string;
  settings: NotionAiPropertySettings;
  currentPageBody?: string;
  dataSourceId?: string;
}

export interface AiTaskExecutorDependencies {
  store: AiTaskExecutionStore;
  credentials: { getActiveCredential(userId: string): Promise<ActiveAiProviderCredential> };
  notion: AiTaskExecutionNotionClient;
  fetcher: Pick<PublicPageFetcher, 'fetch'>;
  providerFor(provider: ActiveAiProviderCredential['provider'], model: string): AiProviderAdapter;
  providerControl?: { isAllowed(provider: ActiveAiProviderCredential['provider'], mode: 'single_page' | 'batch'): Promise<boolean> };
  diagnostics?: { record(taskId: string, input: { providerRequestId?: string; inputTokens?: number; outputTokens?: number; durationMs?: number; errorCode?: string }): Promise<void> };
}

/** Executes an already-claimed task. The caller owns the lease and never persists page body or prompt. */
export class AiTaskExecutor {
  constructor(private readonly dependencies: AiTaskExecutorDependencies) {}

  async execute(task: ExecutableAiTask, context: AiTaskExecutionContext): Promise<AiGenerationStatus> {
    const startedAt = Date.now();
    if (!task.leaseToken) return 'paused';
    if (task.sourceUrl && isAiSourceDisallowed(task.sourceUrl)) {
      await this.complete(task, 'skipped', 'skipped_fetch_disallowed');
      return 'skipped';
    }
    let credential: ActiveAiProviderCredential;
    try {
      credential = await this.dependencies.credentials.getActiveCredential(task.userId);
    } catch {
      await this.complete(task, 'needs_action', 'needs_action_credential_deleted');
      return 'needs_action';
    }
    if (!isAiProvider(task.provider) || credential.provider !== task.provider || credential.credentialVersion !== task.credentialVersion) {
      await this.complete(task, 'needs_action', 'needs_action_credential_deleted');
      return 'needs_action';
    }
    if (this.dependencies.providerControl && !(await this.dependencies.providerControl.isAllowed(credential.provider, task.mode))) {
      await this.complete(task, 'service_unavailable', 'service_provider_paused');
      return 'service_unavailable';
    }

    let page: NotionPageForAi;
    try {
      page = await this.dependencies.notion.getPage(task.notionPageId, context.accessToken);
    } catch {
      await this.complete(task, 'needs_action', 'needs_action_notion_authorization');
      await this.recordDiagnostic(task.id, {
        durationMs: Date.now() - startedAt,
        errorCode: 'needs_action_notion_authorization',
      });
      return 'needs_action';
    }
    if (isUnavailableNotionTarget(page, context.dataSourceId)) {
      await this.complete(task, 'skipped', 'skipped_target_unavailable');
      return 'skipped';
    }
    const description = extractRichTextById(
      page.properties,
      context.settings.descriptionPropertyId
    );
    const title = extractTitle(page.properties);
    // A number of sites deny server-side HTML fetching. The description already
    // saved in Notion is a privacy-safe, bounded fallback that still allows AI to
    // generate useful tags and a concise replacement summary.
    const resolvedBody = await this.resolveBody(task, context.currentPageBody);
    const body = selectSufficientAiContent(resolvedBody.body, description, title);
    if (!body) {
      await this.complete(task, 'skipped', resolvedBody.reasonCode || 'skipped_insufficient_content');
      return 'skipped';
    }

    const tagCandidates = await this.loadTagCandidates(context);
    const prompt = buildAiGenerationPrompt({
      title,
      url: task.sourceUrl || '',
      description,
      body,
      currentTags: extractTagsById(page.properties, context.settings.tagsPropertyId),
      tagCandidates,
    });

    let generated: Awaited<ReturnType<AiProviderAdapter['generate']>>;
    try {
      generated = await this.dependencies.providerFor(credential.provider, task.model).generate(credential.apiKey, prompt.prompt);
    } catch (error) {
      return this.handleProviderFailure(task, credential, startedAt, error);
    }

    let output: ReturnType<typeof parseAiModelOutput>;
    try {
      output = parseAiModelOutput(generated.text, prompt.language);
    } catch (error) {
      if (error instanceof AiGenerationOutputError && error.code === 'summary_too_long' && error.recoverableOutput) {
        try {
          const compressed = await this.dependencies.providerFor(credential.provider, task.model).generate(
            credential.apiKey,
            buildAiSummaryCompressionPrompt(error.recoverableOutput)
          );
          output = parseAiModelOutput(compressed.text, prompt.language);
          generated = mergeGenerationDiagnostics(generated, compressed);
        } catch (compressionError) {
          if (compressionError instanceof AiProviderGenerationError) {
            return this.handleProviderFailure(task, credential, startedAt, compressionError);
          }
          await this.complete(task, 'failed', 'failed_invalid_output');
          await this.recordDiagnostic(task.id, { durationMs: Date.now() - startedAt, errorCode: 'failed_invalid_output' });
          return 'failed';
        }
      } else {
        await this.complete(task, 'failed', 'failed_invalid_output');
        await this.recordDiagnostic(task.id, { durationMs: Date.now() - startedAt, errorCode: 'failed_invalid_output' });
        return 'failed';
      }
    }
    if (!output) {
      await this.complete(task, 'failed', 'failed_invalid_output');
      await this.recordDiagnostic(task.id, { durationMs: Date.now() - startedAt, errorCode: 'failed_invalid_output' });
      return 'failed';
    }
    if (output.status === 'insufficient_content') {
      await this.complete(task, 'skipped', 'skipped_insufficient_content');
      return 'skipped';
    }
    output = { ...output, tags: canonicalizeGeneratedTags(output.tags, tagCandidates) };

    // Refresh immediately before deciding what can be written. User changes made
    // while the provider was running must win over the generated result.
    let latestPage: NotionPageForAi;
    try {
      latestPage = await this.dependencies.notion.getPage(task.notionPageId, context.accessToken);
    } catch {
      await this.complete(task, 'needs_action', 'needs_action_notion_authorization');
      return 'needs_action';
    }

    let prepared: ReturnType<typeof prepareNotionAiWrite>;
    try {
      prepared = prepareNotionAiWrite(latestPage, context.settings, output, task.descriptionBaselineHash || undefined);
    } catch (error) {
      const isTargetUnavailable = error instanceof NotionAiWriteError && error.code === 'target_unavailable';
      const status = isTargetUnavailable ? 'needs_action' : 'failed';
      const reasonCode = isTargetUnavailable ? 'needs_action_notion_schema' : 'failed_invalid_output';
      await this.complete(task, status, reasonCode);
      await this.recordDiagnostic(task.id, { durationMs: Date.now() - startedAt, errorCode: reasonCode });
      return status;
    }

    // Credential rotation/deletion clears the lease. Revalidate both facts after
    // the model call so an in-flight request can never write with a revoked key.
    try {
      const current = await this.dependencies.credentials.getActiveCredential(task.userId);
      if (current.provider !== credential.provider || current.credentialVersion !== credential.credentialVersion) return 'paused';
    } catch {
      return 'paused';
    }
    if (this.dependencies.providerControl && !(await this.dependencies.providerControl.isAllowed(credential.provider, task.mode))) {
      await this.complete(task, 'service_unavailable', 'service_provider_paused');
      return 'service_unavailable';
    }
    if (!(await this.dependencies.store.hasActiveLease(task.id, task.leaseToken))) return 'paused';

    try {
      await this.dependencies.notion.updatePage(task.notionPageId, prepared.properties, context.accessToken);
    } catch (error) {
      logNotionWriteFailure(error);
      if (isNotionArchivedTargetError(error)) {
        await this.complete(task, 'skipped', 'skipped_target_unavailable');
        return 'skipped';
      }
      if (isNotionAuthorizationError(error)) {
        await this.complete(task, 'needs_action', 'needs_action_notion_authorization');
        await this.recordDiagnostic(task.id, {
          durationMs: Date.now() - startedAt,
          errorCode: 'needs_action_notion_authorization',
        });
        return 'needs_action';
      }
      const reconciled = await this.reconcileNotionWrite(task, context, output);
      if (reconciled !== 'succeeded') return reconciled;
    }

    await this.complete(task, 'succeeded');
    await this.recordDiagnostic(task.id, {
      providerRequestId: generated.providerRequestId,
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
      durationMs: Date.now() - startedAt,
    });
    return 'succeeded';
  }

  private async resolveBody(
    task: ExecutableAiTask,
    currentPageBody?: string
  ): Promise<{ body?: string; reasonCode?: 'skipped_fetch_disallowed' | 'skipped_unsupported_content_type' }> {
    if (task.mode === 'single_page') return { body: currentPageBody?.trim() || undefined };
    if (!task.sourceUrl) return {};
    try {
      return { body: (await this.dependencies.fetcher.fetch(task.sourceUrl)).body || undefined };
    } catch (error) {
      if (error instanceof PublicPageFetchError && error.code === 'fetch_disallowed') {
        return { reasonCode: 'skipped_fetch_disallowed' };
      }
      if (error instanceof PublicPageFetchError && error.code === 'unsupported_content_type') {
        return { reasonCode: 'skipped_unsupported_content_type' };
      }
      return {};
    }
  }

  private async complete(task: ExecutableAiTask, status: AiGenerationStatus, reasonCode?: AiGenerationReasonCode) {
    if (!task.leaseToken) return false;
    const persisted = await this.dependencies.store.complete(task.id, task.leaseToken, status, reasonCode);
    console.info(
      `[AI Task] Completion: status=${status}, reason=${reasonCode || 'none'}, persisted=${persisted}`
    );
    return persisted;
  }

  private async handleProviderFailure(
    task: ExecutableAiTask,
    credential: ActiveAiProviderCredential,
    startedAt: number,
    error: unknown
  ): Promise<AiGenerationStatus> {
    if (error instanceof AiProviderGenerationError) {
      const reasonCode = providerNeedsActionReason(error.code);
      if (reasonCode) {
        await this.dependencies.store.stopUserTasksForProviderError(
          task.userId,
          credential.provider,
          credential.credentialVersion,
          reasonCode
        );
        await this.recordDiagnostic(task.id, { durationMs: Date.now() - startedAt, errorCode: reasonCode });
        return 'needs_action';
      }
      task.providerRetryAfterMs = error.retryAfterMs;
    }
    await this.complete(task, 'failed', 'failed_provider_request');
    await this.recordDiagnostic(task.id, { durationMs: Date.now() - startedAt, errorCode: 'failed_provider_request' });
    return 'failed';
  }

  private async loadTagCandidates(context: AiTaskExecutionContext): Promise<string[]> {
    if (!context.dataSourceId || !this.dependencies.notion.getAiTagCandidates) return [];
    try {
      return (await this.dependencies.notion.getAiTagCandidates(
        context.dataSourceId,
        context.accessToken,
        context.settings.tagsPropertyId
      )).slice(0, 100);
    } catch {
      return [];
    }
  }

  private async reconcileNotionWrite(
    task: ExecutableAiTask,
    context: AiTaskExecutionContext,
    output: Extract<ReturnType<typeof parseAiModelOutput>, { status: 'ok' }>
  ): Promise<AiGenerationStatus> {
    let refreshed: NotionPageForAi;
    try {
      refreshed = await this.dependencies.notion.getPage(task.notionPageId, context.accessToken);
    } catch (error) {
      logNotionWriteFailure(error);
      if (isNotionArchivedTargetError(error)) {
        await this.complete(task, 'skipped', 'skipped_target_unavailable');
        return 'skipped';
      }
      if (isNotionAuthorizationError(error)) {
        await this.complete(task, 'needs_action', 'needs_action_notion_authorization');
        return 'needs_action';
      }
      await this.complete(task, 'failed', 'failed_notion_write');
      return 'failed';
    }
    if (doesNotionPageMatchAiOutput(refreshed, context.settings, output)) return 'succeeded';

    let retry: ReturnType<typeof prepareNotionAiWrite>;
    try {
      retry = prepareNotionAiWrite(refreshed, context.settings, output, task.descriptionBaselineHash || undefined);
    } catch (error) {
      const targetUnavailable = error instanceof NotionAiWriteError && error.code === 'target_unavailable';
      await this.complete(task, targetUnavailable ? 'needs_action' : 'failed', targetUnavailable ? 'needs_action_notion_schema' : 'failed_notion_write');
      return targetUnavailable ? 'needs_action' : 'failed';
    }
    if (!task.leaseToken || !(await this.dependencies.store.hasActiveLease(task.id, task.leaseToken))) return 'paused';
    try {
      await this.dependencies.notion.updatePage(task.notionPageId, retry.properties, context.accessToken);
      return 'succeeded';
    } catch {
      await this.complete(task, 'failed', 'failed_notion_write');
      return 'failed';
    }
  }

  private async recordDiagnostic(taskId: string, input: { providerRequestId?: string; inputTokens?: number; outputTokens?: number; durationMs?: number; errorCode?: string }) {
    try { await this.dependencies.diagnostics?.record(taskId, input); } catch { /* diagnostics must never alter task outcome */ }
  }
}

function logNotionWriteFailure(error: unknown): void {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined;
  const code = typeof record?.code === 'string' ? record.code : 'unknown';
  const status = typeof record?.status === 'number' ? record.status : 'unknown';
  // Deliberately omit the provider response message because it may include page
  // property values. Code and HTTP status are sufficient for production diagnosis.
  console.warn(`[AI Task] Notion write rejected: code=${code}, status=${status}`);
}

function isNotionAuthorizationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  return record.code === 'restricted_resource' || record.code === 'unauthorized' || record.status === 401 || record.status === 403;
}

function isNotionArchivedTargetError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message.toLocaleLowerCase() : '';
  return record.code === 'validation_error'
    && (message.includes('archived ancestor') || message.includes('trashed ancestor'));
}

function isUnavailableNotionTarget(page: NotionPageForAi, dataSourceId?: string): boolean {
  if (page.archived === true || page.in_trash === true) return true;
  if (!dataSourceId || !page.parent) return false;
  const parentDataSourceId = page.parent.data_source_id;
  return typeof parentDataSourceId === 'string' && parentDataSourceId !== dataSourceId;
}

function mergeGenerationDiagnostics(
  first: Awaited<ReturnType<AiProviderAdapter['generate']>>,
  second: Awaited<ReturnType<AiProviderAdapter['generate']>>
): Awaited<ReturnType<AiProviderAdapter['generate']>> {
  return {
    ...second,
    inputTokens: addOptionalIntegers(first.inputTokens, second.inputTokens),
    outputTokens: addOptionalIntegers(first.outputTokens, second.outputTokens),
  };
}

function addOptionalIntegers(first?: number, second?: number): number | undefined {
  return first === undefined && second === undefined ? undefined : (first || 0) + (second || 0);
}

function providerNeedsActionReason(
  code: AiProviderGenerationError['code']
): Extract<AiGenerationReasonCode, 'needs_action_invalid_api_key' | 'needs_action_insufficient_quota' | 'needs_action_model_access'> | undefined {
  if (code === 'invalid_api_key') return 'needs_action_invalid_api_key';
  if (code === 'insufficient_quota') return 'needs_action_insufficient_quota';
  if (code === 'model_access') return 'needs_action_model_access';
  return undefined;
}

function extractTitle(properties: Record<string, unknown>): string {
  for (const value of Object.values(properties)) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    if (record.type !== 'title') continue;
    return richText(record.title);
  }
  return '';
}

function extractRichTextById(properties: Record<string, unknown>, propertyId: string): string {
  const property = findById(properties, propertyId);
  return property?.type === 'rich_text' ? richText(property.rich_text) : '';
}

function extractTagsById(properties: Record<string, unknown>, propertyId: string): string[] {
  const property = findById(properties, propertyId);
  if (property?.type !== 'multi_select' || !Array.isArray(property.multi_select)) return [];
  return property.multi_select.flatMap((item) => {
    const name = item && typeof item === 'object' ? (item as Record<string, unknown>).name : undefined;
    return typeof name === 'string' ? [name] : [];
  });
}

function findById(properties: Record<string, unknown>, propertyId: string): Record<string, any> | undefined {
  return Object.values(properties).find((value): value is Record<string, any> =>
    !!value && typeof value === 'object' && (value as Record<string, unknown>).id === propertyId
  );
}

function richText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.flatMap((item) => {
    const plain = item && typeof item === 'object' ? (item as Record<string, unknown>).plain_text : undefined;
    return typeof plain === 'string' ? [plain] : [];
  }).join('');
}
