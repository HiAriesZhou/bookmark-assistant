import { Router, Response } from 'express';
import { isAiProvider } from '../services/ai-provider';
import { config } from '../config';
import { validateSession } from '../middleware/auth';
import type { AuthenticatedRequest } from '../types';
import { auditLog } from '../utils';
import { AiCredentialService } from '../services';
import { AiCredentialNotFoundError } from '../services/ai-credential-service';
import {
  AI_PROVIDER_DEFAULT_MODELS,
  AiProviderValidationError,
  createAiProviderAdapter,
} from '../services/ai-provider-adapters';
import {
  createCredentialCipher,
  CredentialCipherConfigurationError,
} from '../services/credential-cipher';
import { PrismaAiCredentialStore } from '../services/prisma-ai-credential-store';
import {
  AiSettingsService,
  isAiSourceDisallowed,
  isSinglePageAiConfigured,
} from '../services/ai-settings-service';
import { PrismaAiSettingsStore } from '../services/prisma-ai-settings-store';
import { AiTaskQueue } from '../services/ai-task-queue';
import { PrismaAiTaskStore } from '../services/prisma-ai-task-store';
import { AiTaskExecutor } from '../services/ai-task-executor';
import { PublicPageFetcher, resolvePublicUrl } from '../services/public-page-fetcher';
import { notionService } from '../services/notion';
import { userPrisma } from '../services/userPrisma';
import { AiBatchService } from '../services/ai-batch-service';
import { PrismaAiBatchStore } from '../services/prisma-ai-batch-store';
import { resolveProEntitlement } from '../utils';
import { AiDiagnosticsService } from '../services/ai-diagnostics-service';
import { runAiTasksForUserWithSummary } from '../jobs/ai-task-worker';
import { getDescriptionBaselineHash } from '../services/notion-ai-writer';
import {
  AiProviderControlService,
  PrismaAiProviderControlStore,
} from '../services/ai-provider-control-service';
import { cleanupExpiredAiDiagnosticsOpportunistically } from '../jobs/ai-diagnostic-cleanup';
import { runSinglePageAiWithRetry } from '../services/single-page-ai-runner';

const router: import('express').Router = Router();

router.use(async (_req, _res, next) => {
  await cleanupExpiredAiDiagnosticsOpportunistically();
  next();
});

function getCredentialService(): AiCredentialService {
  return new AiCredentialService(
    new PrismaAiCredentialStore(),
    createCredentialCipher(config.aiCredentialEncryption)
  );
}

function getSettingsService(): AiSettingsService {
  return new AiSettingsService(new PrismaAiSettingsStore());
}

function getBatchService(): AiBatchService {
  return new AiBatchService(new PrismaAiBatchStore());
}
function getProviderControl(): AiProviderControlService {
  return new AiProviderControlService(new PrismaAiProviderControlStore());
}

router.get('/credential', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!config.aiCredentialEncryption.available) {
      return res.json({
        success: true,
        credential: null,
        encryptionAvailable: false,
        providerModels: AI_PROVIDER_DEFAULT_MODELS,
      });
    }

    const credential = await getCredentialService().getCredentialSummary(req.user!.userId);
    return res.json({
      success: true,
      credential: credential ?? null,
      encryptionAvailable: true,
      providerModels: AI_PROVIDER_DEFAULT_MODELS,
    });
  } catch (error) {
    return handleCredentialError(error, req, res);
  }
});

router.put('/credential', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  const provider = req.body?.provider;
  const apiKey = req.body?.apiKey;
  if (!isAiProvider(provider) || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({
      error: 'Invalid Request',
      code: 'invalid_credential_input',
      message: 'Choose a supported AI provider and enter an API key.',
    });
  }

  try {
    // Validate before encryption/persistence so a failed replacement leaves the old key intact.
    if (!(await getProviderControl().isAllowed(provider, 'validation'))) {
      return res
        .status(503)
        .json({
          error: 'AI Provider Paused',
          code: 'service_provider_paused',
          message: 'This AI provider is temporarily unavailable.',
        });
    }
    await createAiProviderAdapter(provider).validateApiKey(apiKey.trim());
    const credential = await getCredentialService().saveVerifiedCredential(
      req.user!.userId,
      provider,
      apiKey
    );
    auditLog('ai_credential_verified', req.user!.userId, { provider });
    return res.status(201).json({ success: true, credential });
  } catch (error) {
    return handleCredentialError(error, req, res, provider);
  }
});

router.delete('/credential', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await getCredentialService().deleteCredential(req.user!.userId);
    auditLog('ai_credential_deleted', req.user!.userId, {});
    return res.status(204).send();
  } catch (error) {
    return handleCredentialError(error, req, res);
  }
});

router.get('/settings', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  const settings = await getSettingsService().get(req.user!.userId);
  return res.json({ success: true, settings: settings || null });
});

router.put('/settings', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body || {};
  if (
    typeof body.singlePageEnabled !== 'boolean' ||
    typeof body.batchEnabled !== 'boolean'
  ) {
    return res.status(400).json({ error: 'Invalid Request', message: 'AI settings are invalid.' });
  }
  const user = await userPrisma.find(req.user!.userId);
  if (!user?.notionAccessToken || (!user.notionDataSourceId && !user.notionDatabaseId)) {
    return res
      .status(409)
      .json({
        error: 'Notion Unavailable',
        message: 'Connect the Bookmark Assistant Notion template before enabling AI.',
      });
  }
  let properties: { descriptionPropertyId: string; tagsPropertyId: string };
  try {
    const dataSourceId =
      user.notionDataSourceId ||
      (await notionService.getPrimaryDataSourceId(user.notionDatabaseId!, user.notionAccessToken));
    properties = await notionService.getAiTemplateProperties(dataSourceId, user.notionAccessToken);
  } catch {
    return res
      .status(409)
      .json({
        error: 'Notion Template Unavailable',
        message:
          'The selected Notion template must include a rich-text Description property and a multi-select Tags property.',
      });
  }
  const settings = await getSettingsService().save(req.user!.userId, {
    singlePageEnabled: body.singlePageEnabled,
    batchEnabled: body.batchEnabled,
    properties,
  });
  if (!settings)
    return res.status(404).json({ error: 'Not Found', message: 'User data not found.' });
  return res.json({ success: true, settings });
});

router.get(
  '/recent-processing',
  validateSession,
  async (req: AuthenticatedRequest, res: Response) => {
    const internalUserId = await userPrisma.resolveInternalUserId(req.user!.userId);
    if (!internalUserId)
      return res.status(404).json({ error: 'Not Found', message: 'User data not found.' });
    const tasks = await new PrismaAiTaskStore().recent(internalUserId, 5);
    return res.json({ success: true, tasks });
  }
);

router.get(
  '/pending-summary',
  validateSession,
  async (req: AuthenticatedRequest, res: Response) => {
    const internalUserId = await userPrisma.resolveInternalUserId(req.user!.userId);
    if (!internalUserId)
      return res.status(404).json({ error: 'Not Found', message: 'User data not found.' });
    const [user, credential] = await Promise.all([
      userPrisma.find(req.user!.userId),
      getCredentialService().getCredentialSummary(req.user!.userId),
    ]);
    if (!user)
      return res.status(404).json({ error: 'Not Found', message: 'User data not found.' });
    const summary = await new PrismaAiTaskStore().getBatchExecutionSummary(
      internalUserId,
      credential?.status === 'verified' ? credential.provider : undefined,
      user.notionDataSourceId
    );
    return res.json({
      success: true,
      pending: summary.ready + summary.retryable,
      ...summary,
    });
  }
);

/**
 * Browser-driven batch processing for Vercel Hobby. This endpoint never handles
 * another user's tasks and only runs while the signed-in user keeps Options open.
 */
router.post('/run-pending', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  const [user, settings, credential] = await Promise.all([
    userPrisma.find(req.user!.userId),
    getSettingsService().get(req.user!.userId),
    getCredentialService().getCredentialSummary(req.user!.userId),
  ]);
  if (!user || !resolveProEntitlement(user).isPro) {
    return res
      .status(403)
      .json({
        error: 'Pro Required',
        code: 'pro_required',
        message: 'Batch AI generation requires Pro.',
      });
  }
  if (!settings?.batchEnabled) {
    return res
      .status(409)
      .json({
        error: 'Batch AI Disabled',
        code: 'batch_ai_disabled',
        message: 'Save AI settings with Batch generation enabled before running pending items.',
      });
  }
  if (!settings.properties) {
    return res
      .status(409)
      .json({
        error: 'AI Not Configured',
        code: 'ai_not_configured',
        message: 'Save AI settings after restoring the Description and Tags template properties.',
      });
  }
  if (credential?.status !== 'verified') {
    return res
      .status(409)
      .json({
        error: 'AI Credential Required',
        code: 'credential_required',
        message: 'Save a verified AI key before running pending items.',
      });
  }
  const internalUserId = await userPrisma.resolveInternalUserId(req.user!.userId);
  if (!internalUserId)
    return res.status(404).json({ error: 'Not Found', message: 'User data not found.' });
  if (!(await getProviderControl().isAllowed(credential.provider, 'batch'))) {
    return res
      .status(503)
      .json({
        error: 'AI Provider Paused',
        code: 'service_provider_paused',
        message: 'This AI provider is temporarily unavailable.',
      });
  }

  // A key can be deleted and recreated while durable tasks still reference the
  // previous provider/version. Reconcile only stale tasks before claiming work.
  await getCredentialService().reconcileTasksWithActiveCredential(req.user!.userId);

  const batches = new PrismaAiBatchStore();
  const taskStore = new PrismaAiTaskStore();
  const skippedStaleTargets = user.notionDataSourceId
    ? await taskStore.skipTasksOutsideDataSource(internalUserId, user.notionDataSourceId)
    : 0;
  const confirmedBatches = await batches.confirmAllAwaiting(internalUserId);
  await taskStore.resumeProviderTasks(internalUserId, credential.provider, 'batch');
  const resumedMetadataFallback = await taskStore.resumeMetadataFallbackTasks(
    internalUserId,
    credential.provider,
    'batch'
  );
  const run = await runAiTasksForUserWithSummary(internalUserId, 2);
  const remaining = await taskStore.countClaimableForUser(internalUserId);
  console.info(
    `[AI Batch] Run result: claimed=${run.claimed}, succeeded=${run.succeeded}, skipped=${run.skipped}, failed=${run.failed}, needsAction=${run.needsAction}, skippedStaleTargets=${skippedStaleTargets}, resumedMetadataFallback=${resumedMetadataFallback}, remaining=${remaining}`
  );
  return res.json({
    success: true,
    processed: run.claimed,
    remaining,
    confirmedBatches,
    skippedStaleTargets,
    ...run,
  });
});

router.post('/batches/plan', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  const eligibleCount = req.body?.eligibleCount;
  if (!Number.isInteger(eligibleCount) || eligibleCount < 0) {
    return res
      .status(400)
      .json({ error: 'Invalid Request', message: 'Eligible item count is invalid.' });
  }
  const user = await userPrisma.find(req.user!.userId);
  const settings = await getSettingsService().get(req.user!.userId);
  const credential = await getCredentialService().getCredentialSummary(req.user!.userId);
  if (!user || !resolveProEntitlement(user).isPro) {
    return res
      .status(403)
      .json({
        error: 'Pro Required',
        code: 'pro_required',
        message: 'Batch AI generation requires Pro.',
      });
  }
  if (!settings?.batchEnabled || !settings.properties || credential?.status !== 'verified') {
    return res
      .status(409)
      .json({
        error: 'AI Not Configured',
        code: 'ai_not_configured',
        message: 'Configure AI, Notion properties, and batch generation first.',
      });
  }
  if (!(await getProviderControl().isAllowed(credential.provider, 'batch'))) {
    return res
      .status(503)
      .json({
        error: 'AI Provider Paused',
        code: 'service_provider_paused',
        message: 'This AI provider is temporarily unavailable.',
      });
  }
  const internalUserId = await userPrisma.resolveInternalUserId(req.user!.userId);
  if (!internalUserId)
    return res.status(404).json({ error: 'Not Found', message: 'User data not found.' });
  const batch = await getBatchService().create(
    internalUserId,
    user.notionDataSourceId,
    eligibleCount
  );
  return res.status(201).json({ success: true, batch });
});

router.post(
  '/batches/:batchId/confirm',
  validateSession,
  async (req: AuthenticatedRequest, res: Response) => {
    const internalUserId = await userPrisma.resolveInternalUserId(req.user!.userId);
    if (!internalUserId)
      return res.status(404).json({ error: 'Not Found', message: 'User data not found.' });
    const batch = await getBatchService().confirm(req.params.batchId, internalUserId);
    if (batch?.status === 'queued')
      await new PrismaAiTaskStore().setBatchTaskStatus(batch.id, 'queued');
    return batch
      ? res.json({ success: true, batch })
      : res
          .status(404)
          .json({ error: 'Not Found', message: 'Batch is not awaiting confirmation.' });
  }
);

router.post(
  '/batches/:batchId/skip',
  validateSession,
  async (req: AuthenticatedRequest, res: Response) => {
    const internalUserId = await userPrisma.resolveInternalUserId(req.user!.userId);
    if (!internalUserId)
      return res.status(404).json({ error: 'Not Found', message: 'User data not found.' });
    const batch = await getBatchService().skip(req.params.batchId, internalUserId);
    if (batch?.status === 'skipped')
      await new PrismaAiTaskStore().setBatchTaskStatus(batch.id, 'skipped');
    return batch
      ? res.json({ success: true, batch })
      : res
          .status(404)
          .json({ error: 'Not Found', message: 'Batch is not awaiting confirmation.' });
  }
);

router.post('/current-page', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  const { knowledgeItemId, syncId, url, body } = req.body || {};
  if (
    typeof knowledgeItemId !== 'string' ||
    !knowledgeItemId ||
    typeof syncId !== 'string' ||
    !syncId ||
    typeof url !== 'string' ||
    !isPublicHttpUrl(url) ||
    typeof body !== 'string' ||
    body.length > 12_000
  ) {
    return res
      .status(400)
      .json({ error: 'Invalid Request', message: 'Current page AI input is invalid.' });
  }

  const settings = await getSettingsService().get(req.user!.userId);
  if (!isSinglePageAiConfigured(settings)) {
    return res
      .status(409)
      .json({
        error: 'AI Not Configured',
        code: 'ai_not_configured',
        message: 'Configure AI and Notion properties first.',
      });
  }
  if (isAiSourceDisallowed(url)) {
    return res.status(202).json({ success: true, status: 'skipped_fetch_disallowed' });
  }
  try {
    await resolvePublicUrl(url);
  } catch {
    return res.status(202).json({ success: true, status: 'skipped_fetch_disallowed' });
  }
  const user = await userPrisma.find(req.user!.userId);
  if (!user?.notionAccessToken) {
    return res
      .status(409)
      .json({
        error: 'Notion Unavailable',
        code: 'notion_unavailable',
        message: 'Reconnect Notion before using AI.',
      });
  }
  if (!user.notionDataSourceId) {
    return res
      .status(409)
      .json({
        error: 'Notion Unavailable',
        code: 'notion_unavailable',
        message: 'Select a Notion database before using AI.',
      });
  }
  const notionPageId = await notionService.findPageBySyncId(
    user.notionDataSourceId,
    user.notionAccessToken,
    syncId
  );
  if (!notionPageId) {
    // The current-page body is intentionally not persisted, so there is no
    // durable task to resume when Notion has not exposed the new page yet.
    return res.status(202).json({ success: true, status: 'not_started' });
  }

  const taskStore = new PrismaAiTaskStore();
  const credentials = getCredentialService();
  const credential = await credentials.getCredentialSummary(req.user!.userId);
  if (credential?.status !== 'verified') {
    return res
      .status(409)
      .json({
        error: 'AI Credential Required',
        code: 'credential_required',
        message: 'Configure a verified AI key first.',
      });
  }
  if (!(await getProviderControl().isAllowed(credential.provider, 'single_page'))) {
    return res
      .status(503)
      .json({
        error: 'AI Provider Paused',
        code: 'service_provider_paused',
        message: 'This AI provider is temporarily unavailable.',
      });
  }
  const internalUserId = await userPrisma.resolveInternalUserId(req.user!.userId);
  if (internalUserId)
    await taskStore.resumeProviderTasks(internalUserId, credential.provider, 'single_page');
  const page = await notionService.getPage(notionPageId, user.notionAccessToken);
  const descriptionBaselineHash = getDescriptionBaselineHash(page, settings.properties);
  const queued = await new AiTaskQueue(taskStore, credentials).enqueue({
    externalUserId: req.user!.userId,
    knowledgeItemId,
    notionPageId,
    sourceUrl: url,
    mode: 'single_page',
    descriptionBaselineHash,
  });
  if (!('task' in queued)) {
    return res
      .status(409)
      .json({
        error: 'AI Credential Required',
        code: queued.reason,
        message: 'Configure a verified AI key first.',
      });
  }
  const claimed = await taskStore.claimTask(queued.task.id, crypto.randomUUID());
  if (!claimed) {
    const removed = await taskStore.deleteUnclaimedSinglePageTask(queued.task.id);
    if (removed) return res.status(202).json({ success: true, status: 'not_started' });
    const latest = internalUserId
      ? await taskStore.findTask(internalUserId, knowledgeItemId)
      : undefined;
    return res.status(202).json({ success: true, status: latest?.status || queued.task.status });
  }
  const executor = new AiTaskExecutor({
    store: taskStore,
    credentials,
    notion: notionService,
    fetcher: new PublicPageFetcher(),
    providerFor: (provider, model) => createAiProviderAdapter(provider, fetch, model),
    providerControl: getProviderControl(),
    diagnostics: new AiDiagnosticsService(),
  });
  const executionContext = {
    accessToken: user.notionAccessToken,
    settings: settings.properties,
    currentPageBody: body,
    dataSourceId: user.notionDataSourceId,
  };
  const status = await runSinglePageAiWithRetry(
    claimed,
    (task) => executor.execute(task, executionContext),
    () => taskStore.claimSinglePageRetry(queued.task.id, crypto.randomUUID())
  );
  return res.status(status === 'succeeded' ? 200 : 202).json({ success: true, status });
});

function handleCredentialError(
  error: unknown,
  req: AuthenticatedRequest,
  res: Response,
  provider?: string
) {
  if (error instanceof AiProviderValidationError) {
    auditLog('ai_credential_validation_failed', req.user?.userId || 'unknown', {
      provider: error.provider,
      reason: error.code,
    });
    return res.status(400).json({
      error: 'AI Provider Validation Failed',
      code: error.code,
      message: providerValidationMessage(error.code),
    });
  }
  if (error instanceof CredentialCipherConfigurationError) {
    auditLog('ai_credential_encryption_unavailable', req.user?.userId || 'unknown', {});
    return res.status(503).json({
      error: 'AI Configuration Unavailable',
      code: 'credential_encryption_unavailable',
      message: 'AI key storage is temporarily unavailable. Please try again later.',
    });
  }
  if (error instanceof AiCredentialNotFoundError) {
    return res.status(404).json({ error: 'Not Found', message: 'User data not found.' });
  }

  auditLog('ai_credential_request_failed', req.user?.userId || 'unknown', {
    provider: provider || undefined,
  });
  return res.status(500).json({
    error: 'Internal Server Error',
    message: 'Unable to update AI settings.',
  });
}

function providerValidationMessage(code: AiProviderValidationError['code']): string {
  switch (code) {
    case 'invalid_api_key':
      return 'The API key was not accepted by the selected provider.';
    case 'insufficient_quota':
      return 'The provider account has no available quota or is rate limited.';
    case 'model_access':
      return 'This provider key cannot use the default model at the moment.';
    case 'service_unavailable':
      return 'The provider is temporarily unavailable. Please try again later.';
    default:
      return 'The provider could not validate this API key.';
  }
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

export default router;
