// 📚 Bookmark Management Routes

import { Router, Response } from 'express';
import type {
  BookmarkSyncResult as SyncResult,
  BookmarkSyncResponse,
  BookmarkSyncEnrichmentResponse,
} from '@bookmark-assistant/types';
import {
  buildGoogleS2FaviconUrl,
  belongsToSyncTarget,
  diffLinkItems,
  extractNotionPageFolderAndTags,
  mergeRetryResults,
  normalizeBookmarkForSyncPlanning,
  readRichTextProperty,
  selectRetryableSyncFailures,
  type ExistingLinkRecord,
  type PlannedLinkUpdate,
} from '../core';
import {
  AuthenticatedRequest,
  BookmarkSyncRequest,
  BookmarkItem,
  BookmarkSyncEnrichmentItem,
  BookmarkSyncEnrichmentRequest,
} from '../types';
import { writeLinkItemToNotion, type NotionLinkWriteResult } from '../sinks/notion';
import { validateSession } from '../middleware/auth';
import { notionService } from '../services/notion';
import { userPrisma } from '../services/userPrisma';
import { config } from '../config';
import { auditLog, sanitizeError, validateBookmark, createBatches, sleep } from '../utils';
import { descriptionExtractor } from '../services/description-extractor';
import { AiSettingsService } from '../services/ai-settings-service';
import { PrismaAiSettingsStore } from '../services/prisma-ai-settings-store';
import { AiCredentialService } from '../services/ai-credential-service';
import { PrismaAiCredentialStore } from '../services/prisma-ai-credential-store';
import { createCredentialCipher } from '../services/credential-cipher';
import { AiBatchService } from '../services/ai-batch-service';
import { PrismaAiBatchStore } from '../services/prisma-ai-batch-store';
import { AiTaskQueue, type EnqueueAiBatchTasksInput } from '../services/ai-task-queue';
import { PrismaAiTaskStore } from '../services/prisma-ai-task-store';
import { resolveProEntitlement } from '../utils';
import { createDescriptionBaselineHash } from '../services/notion-ai-writer';
import {
  AiProviderControlService,
  PrismaAiProviderControlStore,
} from '../services/ai-provider-control-service';
import { isBatchAiEligibleCapture } from '../core/ai-batch-eligibility';
import { canStartDescriptionExtraction, canStartNotionWrite } from '../core/sync-time-budget';

const router: import('express').Router = Router();
const NOTION_WRITE_CONCURRENCY = 3;
const SYNC_RESPONSE_RESERVE_MS = 10_000;

type CreatedNotionSyncResult = Extract<NotionLinkWriteResult, { success: true }> & {
  action: 'created';
  syncId: string;
};

type SyncWriteOutcome = {
  results: SyncResult[];
  deferred: number;
};

type CanStartNotionWrite = () => boolean;

/**
 * Sync a single batch of bookmarks to Notion
 * Returns the results of the sync operation for this batch
 */
async function syncBatchToNotion(
  batch: BookmarkItem[],
  verifiedDatabaseId: string,
  verifiedDataSourceId: string,
  userData: { notionAccessToken: string },
  canStartWrite: CanStartNotionWrite
): Promise<SyncWriteOutcome> {
  const allResults: SyncResult[] = [];
  const writeBatches = createBatches(batch, NOTION_WRITE_CONCURRENCY);
  for (let index = 0; index < writeBatches.length; index++) {
    if (!canStartWrite()) {
      return {
        results: allResults,
        deferred: writeBatches.slice(index).reduce((count, pending) => count + pending.length, 0),
      };
    }
    const writeBatch = writeBatches[index];
    const batchPromises = writeBatch.map(async (bookmark: BookmarkItem) => {
      const result = await writeLinkItemToNotion({
        writer: notionService,
        databaseId: verifiedDatabaseId,
        dataSourceId: verifiedDataSourceId,
        accessToken: userData.notionAccessToken,
        item: bookmark,
        buildIconUrl: buildGoogleS2FaviconUrl,
        sanitizeError,
      });
      return { ...result, retryCount: 0 };
    });

    let batchResults = (await Promise.all(batchPromises)) as (SyncResult & {
      retryCount?: number;
    })[];

    // Single retry pass for failed items (max 1 retry per item).
    const retryableFailures = selectRetryableSyncFailures(batchResults);
    if (retryableFailures.length > 0 && canStartWrite()) {
      console.log(
        `[Bookmark Sync] 🔄 Retrying ${retryableFailures.length} failed bookmarks (1 attempt each)...`
      );
      await sleep(1500);
      const retryResults = await Promise.all(
        retryableFailures.map(async (failed) => {
          const originalBookmark = writeBatch.find(
            (bookmark) =>
              (failed.syncId && bookmark.syncId === failed.syncId) ||
              bookmark.title === failed.bookmark
          );
          if (!originalBookmark) return { ...failed, retryCount: 1 };
          const retryResult = await writeLinkItemToNotion({
            writer: notionService,
            databaseId: verifiedDatabaseId,
            dataSourceId: verifiedDataSourceId,
            accessToken: userData.notionAccessToken,
            item: originalBookmark,
            buildIconUrl: buildGoogleS2FaviconUrl,
            sanitizeError,
          });
          return retryResult.success
            ? { ...retryResult, retryCount: 1 }
            : { ...failed, retryCount: 1 };
        })
      );
      batchResults = mergeRetryResults(batchResults, retryResults);
    }

    const batchFailures = batchResults.filter((result) => !result.success);
    if (batchFailures.length > 0) {
      console.warn(`[Bookmark Sync] ⚠️ ${batchFailures.length} items failed in this batch`);
    }
    allResults.push(...batchResults);
  }
  return { results: allResults, deferred: 0 };
}

async function updateBatchInNotion(
  updates: PlannedLinkUpdate[],
  verifiedDataSourceId: string,
  userData: { notionAccessToken: string },
  canStartWrite: CanStartNotionWrite
): Promise<SyncWriteOutcome> {
  const results: SyncResult[] = [];
  const updateBatches = createBatches(updates, NOTION_WRITE_CONCURRENCY);
  for (let index = 0; index < updateBatches.length; index++) {
    if (!canStartWrite()) {
      return {
        results,
        deferred: updateBatches.slice(index).reduce((count, pending) => count + pending.length, 0),
      };
    }
    const updateBatch = updateBatches[index];
    results.push(
      ...(await Promise.all(
        updateBatch.map(async ({ pageId, item }) =>
          writeLinkItemToNotion({
            writer: notionService,
            dataSourceId: verifiedDataSourceId,
            accessToken: userData.notionAccessToken,
            item: item as BookmarkItem,
            pageId,
            buildIconUrl: buildGoogleS2FaviconUrl,
            sanitizeError,
          })
        )
      ))
    );
  }
  return { results, deferred: 0 };
}

async function applySyncPlanToNotion(
  diff: ReturnType<typeof diffLinkItems>,
  verifiedDatabaseId: string,
  verifiedDataSourceId: string,
  userData: { notionAccessToken: string },
  canStartWrite: CanStartNotionWrite
): Promise<SyncWriteOutcome> {
  const results: SyncResult[] = [];
  let deferred = 0;

  if (diff.toCreate.length > 0) {
    const createOutcome = await syncBatchToNotion(
      diff.toCreate as BookmarkItem[],
      verifiedDatabaseId,
      verifiedDataSourceId,
      userData,
      canStartWrite
    );
    results.push(...createOutcome.results);
    deferred += createOutcome.deferred;
  }

  if (deferred === 0 && diff.toUpdate && diff.toUpdate.length > 0) {
    const updateOutcome = await updateBatchInNotion(
      diff.toUpdate,
      verifiedDataSourceId,
      userData,
      canStartWrite
    );
    results.push(...updateOutcome.results);
    deferred += updateOutcome.deferred;
  } else if (deferred > 0 && diff.toUpdate?.length) {
    deferred += diff.toUpdate.length;
  }

  return { results, deferred };
}

function addCreatedLinksToExistingIndex(
  createdItems: BookmarkItem[],
  urls: string[],
  syncIds: string[],
  existingRecords: ExistingLinkRecord[]
) {
  for (const item of createdItems) {
    if (item.url) urls.push(item.url);
    if (item.syncId) syncIds.push(item.syncId);
    existingRecords.push({
      url: item.url,
      syncId: item.syncId,
      type: item.type,
      readState: item.readState,
    });
  }
}

function createdItemsFromResults(items: BookmarkItem[], results: SyncResult[]): BookmarkItem[] {
  const createdSyncIds = new Set(
    results
      .filter((result) => result.success && result.action === 'created' && !!result.syncId)
      .map((result) => result.syncId!)
  );
  const createdTitles = new Set(
    results
      .filter((result) => result.success && result.action === 'created' && !result.syncId)
      .map((result) => result.bookmark)
  );
  return items.filter((item) =>
    item.syncId ? createdSyncIds.has(item.syncId) : createdTitles.has(item.title)
  );
}

type AiBatchPlan = Pick<BookmarkSyncEnrichmentResponse, 'aiBatch' | 'aiPlanning'>;

async function planAiBatch({
  userId,
  userData,
  dataSourceId,
  eligibilityItems,
  planningItems,
  aiBatchEligible,
  deduplicateExisting = false,
}: {
  userId: string;
  userData: NonNullable<Awaited<ReturnType<typeof userPrisma.find>>>;
  dataSourceId: string;
  eligibilityItems: Array<Pick<BookmarkItem, 'source'>>;
  planningItems: EnqueueAiBatchTasksInput['items'];
  aiBatchEligible: boolean | undefined;
  deduplicateExisting?: boolean;
}): Promise<AiBatchPlan> {
  const notEligible = { aiPlanning: { status: 'not_eligible' as const } };
  const settings = await new AiSettingsService(new PrismaAiSettingsStore()).get(userId);
  const credentialService = new AiCredentialService(
    new PrismaAiCredentialStore(),
    createCredentialCipher(config.aiCredentialEncryption)
  );
  const credential = await credentialService.getCredentialSummary(userId);
  const providerAllowed =
    credential?.status === 'verified'
      ? await new AiProviderControlService(new PrismaAiProviderControlStore()).isAllowed(
          credential.provider,
          'batch'
        )
      : false;
  if (
    !(
      isBatchAiEligibleCapture(aiBatchEligible, eligibilityItems) &&
      resolveProEntitlement(userData).isPro &&
      settings?.batchEnabled &&
      settings.properties &&
      credential?.status === 'verified' &&
      providerAllowed &&
      planningItems.length > 0
    )
  )
    return notEligible;

  const internalUserId = await userPrisma.resolveInternalUserId(userId);
  if (!internalUserId) return notEligible;
  const taskStore = new PrismaAiTaskStore();
  // Deferred enrichment is retried across worker restarts. Its preliminary lookup
  // avoids empty replacement batches; durable queue uniqueness remains authoritative.
  const existingKnowledgeItemIds = deduplicateExisting
    ? await taskStore.findExistingKnowledgeItemIds(
        internalUserId,
        planningItems.map((item) => item.knowledgeItemId)
      )
    : new Set<string>();
  const newPlanningItems = planningItems.filter(
    (item) => !existingKnowledgeItemIds.has(item.knowledgeItemId)
  );
  if (newPlanningItems.length === 0) {
    return { aiPlanning: { status: 'planned', taskCount: planningItems.length } };
  }
  const batch = await new AiBatchService(new PrismaAiBatchStore()).create(
    internalUserId,
    dataSourceId,
    newPlanningItems.length
  );
  const aiBatch = { id: batch.id, status: batch.status, eligibleCount: batch.eligibleCount };
  if (batch.status !== 'queued' && batch.status !== 'awaiting_confirmation') {
    return { aiBatch, ...notEligible };
  }
  const queued = await new AiTaskQueue(taskStore, credentialService).enqueueBatch({
    externalUserId: userId,
    batchId: batch.id,
    initialStatus: batch.status,
    credential,
    items: newPlanningItems,
  });
  return {
    aiBatch,
    aiPlanning: { status: 'planned', taskCount: existingKnowledgeItemIds.size + queued.created },
  };
}

async function planDeferredAiBatch(
  userId: string,
  userData: NonNullable<Awaited<ReturnType<typeof userPrisma.find>>>,
  dataSourceId: string,
  items: BookmarkSyncEnrichmentItem[],
  descriptionBySyncId: Map<string, string>,
  aiBatchEligible: boolean | undefined
): Promise<AiBatchPlan> {
  const createdItems = items.filter(
    (item) => item.action === 'created' && descriptionBySyncId.has(item.syncId)
  );
  return planAiBatch({
    userId,
    userData,
    dataSourceId,
    aiBatchEligible,
    eligibilityItems: createdItems,
    deduplicateExisting: true,
    planningItems: createdItems.map((item) => ({
      knowledgeItemId: item.syncId,
      notionPageId: item.notionPageId,
      sourceUrl: item.url,
      descriptionBaselineHash: createDescriptionBaselineHash(
        descriptionBySyncId.get(item.syncId) || item.description || ''
      ),
    })),
  });
}

/**
 * Enhanced Bookmark Sync Endpoint
 * High-level sync with smart batching and duplicate handling
 */
router.post('/sync', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  const requestStartedAt = Date.now();
  try {
    const userId = req.user!.userId;
    const userData = await userPrisma.find(userId);
    console.debug(
      '[Bookmark Sync] User data fetched:',
      userData
        ? {
            hasNotionAccessToken: !!userData.notionAccessToken,
            hasNotionRefreshToken: !!userData.notionRefreshToken,
            hasNotionDatabaseId: !!userData.notionDatabaseId,
            hasNotionDataSourceId: !!userData.notionDataSourceId,
            hasDuplicatedTemplateId: !!userData.duplicatedTemplateId,
            hasTemplateDatabaseId: !!userData.templateDatabaseId,
            databaseCount: Array.isArray(userData.databases) ? userData.databases.length : 0,
            plan: userData.plan,
          }
        : null
    );
    const {
      dataSourceId,
      bookmarks,
      readingList,
      items,
      options = {},
      aiBatchEligible = true,
    }: BookmarkSyncRequest = req.body;
    const hasLegacyBookmarks = Array.isArray(bookmarks);
    const hasReadingList = Array.isArray(readingList);
    const hasItems = Array.isArray(items);
    const syncItems = hasItems
      ? items
      : [...(hasLegacyBookmarks ? bookmarks : []), ...(hasReadingList ? readingList : [])];
    console.debug('[Bookmark Sync] Sync request received:', {
      dataSourceId,
      bookmarkCount: Array.isArray(bookmarks) ? bookmarks.length : 'invalid',
      readingListCount: Array.isArray(readingList) ? readingList.length : 'invalid',
      itemCount: Array.isArray(items) ? items.length : syncItems.length,
      options,
    });
    console.log(
      `[Bookmark Sync] 📊 Received: hasItems=${hasItems}, hasReadingList=${hasReadingList}, syncItems.length=${syncItems.length}`
    );
    if (!userData) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User data not found',
      });
    }

    if (!hasItems && !hasLegacyBookmarks && !hasReadingList) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Sync items must be provided as items or bookmarks/readingList arrays',
      });
    }

    const effectiveDataSourceId = userData.notionDataSourceId;
    if (!effectiveDataSourceId) {
      return res.status(400).json({
        error: 'Bad Request',
        message:
          'dataSourceId is required for sync. Please complete OAuth and share the template/database with the integration so the server can resolve it.',
      });
    }

    // Check if notionDatabaseId exists
    if (!userData.notionDatabaseId) {
      console.error('[Bookmark Sync] ❌ No notionDatabaseId found in user data');

      // Attempt recovery if we have duplicatedTemplateId
      if (userData.duplicatedTemplateId) {
        console.log('[Bookmark Sync] 🔄 Attempting database recovery from duplicatedTemplateId...');
        try {
          const resolved = await notionService.resolveDatabaseFromTemplate(
            userData.duplicatedTemplateId,
            userData.notionAccessToken
          );

          // Update user record with recovered database
          await userPrisma.update(userData.id!, {
            notionDatabaseId: resolved.databaseId,
            notionDataSourceId: resolved.dataSourceId,
            notionDatabaseName: resolved.databaseName,
            templateDatabaseId: resolved.databaseId, // Keep in sync
          });

          // Update local userData for this request
          userData.notionDatabaseId = resolved.databaseId;
          userData.notionDataSourceId = resolved.dataSourceId;

          console.log('[Bookmark Sync] ✅ Database recovered successfully', {
            hasDatabaseId: !!resolved.databaseId,
            hasDataSourceId: !!resolved.dataSourceId,
          });
        } catch (recoveryError) {
          console.error('[Bookmark Sync] ❌ Database recovery failed:', recoveryError);
          return res.status(400).json({
            error: 'Database Not Configured',
            message:
              'No database ID found and recovery failed. Please reconnect your Notion integration.',
            suggestion: 'Go to Settings → Disconnect → Reconnect to reconfigure database',
            recoveryAttempted: true,
            recoveryError: recoveryError instanceof Error ? recoveryError.message : 'Unknown error',
          });
        }
      } else {
        // No template ID available for recovery
        return res.status(400).json({
          error: 'Database Not Configured',
          message: 'No database ID found. Please reconnect your Notion integration.',
          suggestion: 'Go to Settings → Disconnect → Reconnect to reconfigure database',
        });
      }
    }

    // Verify database access and recover if needed
    let verifiedDatabaseId = userData.notionDatabaseId;
    let verifiedDataSourceId = effectiveDataSourceId;

    console.log('[Bookmark Sync] 🔍 Verifying database access...');

    try {
      const verification = await notionService.verifyDatabaseAccess(
        userData.notionDatabaseId,
        userData.notionAccessToken
      );
      verifiedDatabaseId = verification.databaseId;
      verifiedDataSourceId = verification.dataSourceId;
    } catch (error) {
      console.error('[Bookmark Sync] ❌ Database verification failed:', error);
      return res.status(400).json({
        error: 'Database Not Accessible',
        message: error instanceof Error ? error.message : 'Failed to verify database access',
        suggestion:
          'Please ensure the database is shared with your Notion integration. Go to your Notion database → ••• menu → Add connections → Select your integration.',
        databaseId: userData.notionDatabaseId,
      });
    }

    // Validate and enrich bookmarks
    let enrichedBookmarks = syncItems.map((bookmark: any, index: number) =>
      validateBookmark(bookmark, index)
    );

    const readingListValidatedCount = enrichedBookmarks.filter(
      (b: any) => b.type === 'reading_list'
    ).length;
    const bookmarkValidatedCount = enrichedBookmarks.filter(
      (b: any) => b.type !== 'reading_list'
    ).length;
    console.log(
      `[Bookmark Sync] 📊 After validation: total=${enrichedBookmarks.length}, bookmarks=${bookmarkValidatedCount}, readingList=${readingListValidatedCount}`
    );

    // Query existing bookmarks to build sync map
    // Limit to 50 pages (5000 bookmarks) to avoid rate limits
    // For larger databases, we'll sync what we can and accept some duplicates
    // NOTE: This is called BEFORE description extraction so we can sync each batch immediately
    const { urls, syncIds, records } = await notionService.existingBookmarkUrls(
      verifiedDataSourceId,
      userData.notionAccessToken,
      {
        maxPages: 50, // Reduced from 100 to avoid rate limits
        timeoutMs: 45000, // 45 second timeout
      }
    );
    const initialUrls = [...urls];
    const initialSyncIds = [...syncIds];
    const existingRecords: ExistingLinkRecord[] = records || [];
    const initialExistingRecords = existingRecords.map((record) => ({ ...record }));

    // Description extraction is only useful for an item that this request will
    // create or update. Processing every historical browser item can exceed the
    // serverless request duration before the new item and its AI task are planned.
    const initialSyncPlan = diffLinkItems(
      enrichedBookmarks as BookmarkItem[],
      existingRecords,
      urls,
      syncIds
    );
    const descriptionCandidates = new Set<BookmarkItem>([
      ...(initialSyncPlan.toCreate as BookmarkItem[]),
      ...((initialSyncPlan.toUpdate || []).map((update) => update.item) as BookmarkItem[]),
    ]);

    // Initialize results array for tracking sync outcomes
    const results: SyncResult[] = [];
    let descriptionSkippedByBudget = 0;
    let deferredNotionWrites = 0;
    let notionWritesDeferred = false;
    const canStartWrite = () =>
      canStartNotionWrite({
        startedAt: requestStartedAt,
        now: Date.now,
        requestBudgetMs: config.syncTimeBudget?.requestMs ?? 240_000,
        reserveForResponseMs: SYNC_RESPONSE_RESERVE_MS,
      });

    // Each phase shares result accounting, deadline handling and the creation index.
    const applyItems = async (items: BookmarkItem[]): Promise<SyncWriteOutcome> => {
      const diff = diffLinkItems(items, existingRecords, urls, syncIds);
      const outcome = await applySyncPlanToNotion(
        diff,
        verifiedDatabaseId,
        verifiedDataSourceId,
        userData,
        canStartWrite
      );
      results.push(...outcome.results);
      deferredNotionWrites += outcome.deferred;
      notionWritesDeferred ||= outcome.deferred > 0;
      addCreatedLinksToExistingIndex(
        createdItemsFromResults(diff.toCreate as BookmarkItem[], outcome.results),
        urls,
        syncIds,
        existingRecords
      );
      return outcome;
    };

    // Generate descriptions for bookmarks without them (if enabled)
    const deferEnhancements = options.deferEnhancements === true;
    const generateDescriptions = options.generateDescriptions !== false && !deferEnhancements;
    if (generateDescriptions) {
      console.log('[Bookmark Sync] Generating descriptions for bookmarks without them...');

      // Filter bookmarks that need description extraction
      const bookmarksNeedingDescriptions = enrichedBookmarks.filter(
        (bookmark) =>
          descriptionCandidates.has(bookmark as BookmarkItem) &&
          !bookmark.description?.trim() &&
          bookmark.url
      );

      if (bookmarksNeedingDescriptions.length > 0) {
        console.log(
          `[Bookmark Sync] Extracting descriptions for ${bookmarksNeedingDescriptions.length} bookmarks in batches...`
        );

        // Process descriptions in batches to prevent connection pool exhaustion
        const batchSize = config.descriptionExtraction.batchSize;
        const batchDelay = config.descriptionExtraction.batchDelayMs;
        const descriptionBatches = createBatches(bookmarksNeedingDescriptions, batchSize);

        // Create a map to track updated bookmarks by their identifier
        const updatedBookmarksMap = new Map<string, BookmarkItem>();

        const normalizeBookmark = (bookmark: BookmarkItem): BookmarkItem =>
          normalizeBookmarkForSyncPlanning(bookmark) as BookmarkItem;

        // Capture identity keeps bookmark and reading-list rows separate even
        // when they point at the same URL.
        const getCaptureKey = (bookmark: BookmarkItem) =>
          `${bookmark.type || 'bookmark'}:${bookmark.syncId || bookmark.url}`;
        const processedDescriptionBookmarks = new Set<string>();

        // Process each batch sequentially. Description extraction is optional:
        // yield the remaining work before it consumes the base sync reserve.
        for (let i = 0; i < descriptionBatches.length; i++) {
          if (
            !canStartDescriptionExtraction({
              startedAt: requestStartedAt,
              now: Date.now,
              requestBudgetMs: config.syncTimeBudget?.requestMs ?? 240_000,
              descriptionBudgetMs: config.syncTimeBudget?.descriptionMs ?? 180_000,
              reserveForBaseSyncMs: config.syncTimeBudget?.reserveForBaseSyncMs ?? 60_000,
            })
          ) {
            descriptionSkippedByBudget = descriptionBatches
              .slice(i)
              .reduce((count, pendingBatch) => count + pendingBatch.length, 0);
            console.info(
              `[Bookmark Sync] Description budget reached; syncing ${descriptionSkippedByBudget} remaining items without descriptions`
            );
            break;
          }
          const batch = descriptionBatches[i];
          console.debug(
            `[Bookmark Sync] Processing description batch ${i + 1}/${descriptionBatches.length} (${batch.length} bookmarks)...`
          );

          // Process batch items concurrently (but limit batch size)
          const batchPromises = batch.map(async (bookmark: BookmarkItem) => {
            try {
              // Extract description from URL
              const result = await descriptionExtractor.extractFromUrl(bookmark.url!);
              if (result.success && result.description) {
                console.debug('[Bookmark Sync] Generated description');
                // Store updated bookmark in map
                const updated = normalizeBookmark({
                  ...bookmark,
                  description: result.description,
                });
                updatedBookmarksMap.set(getCaptureKey(bookmark), updated);
                return updated;
              } else {
                console.debug('[Bookmark Sync] Description unavailable');
              }
            } catch (error) {
              console.debug(
                `[Bookmark Sync] Error generating description for ${bookmark.url}:`,
                error
              );
            }
            return normalizeBookmark(bookmark);
          });

          const batchWithDescriptions = await Promise.all(batchPromises);
          for (const bookmark of batch) {
            processedDescriptionBookmarks.add(getCaptureKey(bookmark));
          }

          const batchOutcome = await applyItems(batchWithDescriptions);
          if (batchOutcome.deferred > 0) {
            descriptionSkippedByBudget += descriptionBatches
              .slice(i + 1)
              .reduce((count, pendingBatch) => count + pendingBatch.length, 0);
            break;
          }

          // Add delay between batches to prevent overwhelming the connection pool
          if (i < descriptionBatches.length - 1) {
            await sleep(batchDelay);
          }
        }

        // Update enrichedBookmarks with extracted descriptions
        enrichedBookmarks = enrichedBookmarks.map((bm) => {
          const updated = updatedBookmarksMap.get(getCaptureKey(bm));
          return updated ? normalizeBookmark(updated) : normalizeBookmark(bm);
        });

        console.log('[Bookmark Sync] Description generation completed');

        // After description extraction, sync bookmarks that were NOT in bookmarksNeedingDescriptions
        // (they already had descriptions and were not processed in the batch loop)
        const bookmarksWithDescriptions = enrichedBookmarks.filter(
          (bookmark) =>
            bookmark.description?.trim() &&
            !processedDescriptionBookmarks.has(getCaptureKey(bookmark))
        ) as BookmarkItem[];

        if (!notionWritesDeferred && bookmarksWithDescriptions.length > 0) {
          await applyItems(bookmarksWithDescriptions);
        }

        // Every capture still reaches Notion if optional extraction had to stop.
        // Only process items that were never included in a description batch to
        // avoid repeating an update that already ran above.
        const deferredDescriptionBookmarks = bookmarksNeedingDescriptions.filter(
          (bookmark) => !processedDescriptionBookmarks.has(getCaptureKey(bookmark))
        );
        if (!notionWritesDeferred && deferredDescriptionBookmarks.length > 0) {
          await applyItems(deferredDescriptionBookmarks);
        }
      } else {
        await applyItems(enrichedBookmarks as BookmarkItem[]);
      }
    } else {
      await applyItems(enrichedBookmarks as BookmarkItem[]);
    }

    // Compute summary against the Notion state observed at the start of the request.
    // The mutable urls/syncIds arrays are updated after batch creation to avoid duplicate writes
    // within the same request, so using them here would count newly created items as duplicates.
    const readingListPreSummaryCount = enrichedBookmarks.filter(
      (b: any) => b.type === 'reading_list'
    ).length;
    console.log(
      `[Bookmark Sync] 📊 Before summary: enrichedBookmarks.length=${enrichedBookmarks.length}, readingList=${readingListPreSummaryCount}, results.length=${results.length}`
    );
    const diff = diffLinkItems(
      enrichedBookmarks as BookmarkItem[],
      initialExistingRecords,
      initialUrls,
      initialSyncIds
    );
    console.log('[Bookmark Sync] Diff result:', diff.stats);
    console.log(
      `[Bookmark Sync] Processing: ${diff.toCreate.length} new, ${diff.toUpdate?.length || 0} updates (out of ${enrichedBookmarks.length} received, ${diff.skippedExisting} existing)`
    );

    const successCount = results.filter((r) => r.success).length;
    const updatedCount = results.filter((r) => r.success && r.action === 'updated').length;
    const itemTypeBySyncId = new Map(
      enrichedBookmarks
        .filter((item) => item.syncId)
        .map((item) => [item.syncId, item.type === 'reading_list' ? 'reading_list' : 'bookmark'])
    );
    const readingListResultCount = results.filter(
      (result) => result.syncId && itemTypeBySyncId.get(result.syncId) === 'reading_list'
    ).length;
    const readingListSuccessCount = results.filter(
      (result) =>
        result.success && result.syncId && itemTypeBySyncId.get(result.syncId) === 'reading_list'
    ).length;
    const readingListFailedCount = results.filter(
      (result) =>
        !result.success && result.syncId && itemTypeBySyncId.get(result.syncId) === 'reading_list'
    ).length;
    const readingListSkippedExisting = Math.max(
      0,
      readingListPreSummaryCount - readingListResultCount
    );
    const batchSize = options.batchSize || config.batchDefaults.size;
    const summary = {
      total: enrichedBookmarks.length,
      success: successCount,
      failed: results.length - successCount,
      batchSize,
      skippedExisting: diff.skippedExisting,
      duplicatesBySyncId: diff.stats.matchedBySyncId,
      duplicatesByUrl: (diff.stats.matchedByUrl || 0) + (diff.stats.matchedByTypedUrl || 0),
      updated: updatedCount,
      readingListTotal: readingListPreSummaryCount,
      readingListSuccess: readingListSuccessCount,
      readingListFailed: readingListFailedCount,
      readingListSkippedExisting,
      descriptionSkippedByBudget,
      deferred: deferredNotionWrites,
    };

    const enrichmentItemsBySyncId = new Map(
      enrichedBookmarks.filter((item) => item.syncId).map((item) => [item.syncId!, item])
    );
    const enrichmentItems: BookmarkSyncEnrichmentItem[] = deferEnhancements
      ? results.flatMap((result) => {
          if (
            !result.success ||
            (result.action !== 'created' && result.action !== 'updated') ||
            !result.syncId ||
            !result.notionPageId
          ) {
            return [];
          }
          const item = enrichmentItemsBySyncId.get(result.syncId);
          if (!item?.url) return [];
          return [
            {
              title: item.title,
              url: item.url,
              syncId: result.syncId,
              notionPageId: result.notionPageId,
              action: result.action,
              description: item.description || '',
              source: item.source,
            },
          ];
        })
      : [];

    // AI never blocks the base sync. Batch AI only applies to newly created pages;
    // existing entries must not be overwritten or reprocessed automatically.
    let aiBatch: AiBatchPlan['aiBatch'];
    let aiPlanning: AiBatchPlan['aiPlanning'] | undefined;
    if (!deferEnhancements) {
      aiPlanning = { status: 'not_eligible' };
      try {
        const itemsBySyncId = new Map(
          enrichedBookmarks.filter((item) => item.syncId).map((item) => [item.syncId!, item])
        );
        const eligibleResults = results.filter(
          (result): result is CreatedNotionSyncResult =>
            result.success && result.action === 'created' && !!result.syncId
        );
        const planningItems = eligibleResults.flatMap((result) => {
          const item = itemsBySyncId.get(result.syncId);
          if (!item?.url || !result.notionPageId) return [];
          return [
            {
              knowledgeItemId: result.syncId,
              notionPageId: result.notionPageId,
              sourceUrl: item.url,
              descriptionBaselineHash: createDescriptionBaselineHash(item.description || ''),
            },
          ];
        });
        // Inline eligibility includes every incoming capture; deferred eligibility
        // includes only successfully enriched creations. Keep these inputs distinct.
        ({ aiBatch, aiPlanning } = await planAiBatch({
          userId,
          userData,
          dataSourceId: verifiedDataSourceId,
          eligibilityItems: enrichedBookmarks,
          planningItems,
          aiBatchEligible,
        }));
      } catch (error) {
        // Base sync is already complete and must remain successful if optional AI planning fails.
        console.error('[AI Batch] Planning failed:', sanitizeError(error));
        aiPlanning = { status: 'failed' };
      }
    }

    console.log(
      `[Bookmark Sync] ✅ Sync completed: ${successCount} successful (${updatedCount} updates), ${diff.skippedExisting} existing (${diff.stats.matchedBySyncId} by syncId, ${(diff.stats.matchedByUrl || 0) + (diff.stats.matchedByTypedUrl || 0)} by URL), ${results.length - successCount} failed; readingList total=${readingListPreSummaryCount}, success=${readingListSuccessCount}, failed=${readingListFailedCount}, skipped=${readingListSkippedExisting}`
    );

    console.log(`[Bookmark Sync] ✅ Sending response: summary=${JSON.stringify(summary)}`);

    auditLog('bookmark_sync_success', userId, summary);

    res.json({
      success: true,
      results,
      summary,
      aiBatch,
      aiPlanning,
      ...(enrichmentItems.length > 0
        ? {
            enrichment: {
              items: enrichmentItems,
              aiBatchEligible,
            },
          }
        : {}),
      ...(deferredNotionWrites > 0
        ? {
            partialSync: {
              applied: results.length,
              requested: results.length + deferredNotionWrites,
              processed: results.length,
              skipped: deferredNotionWrites,
              message:
                'Some Notion writes were deferred before the sync deadline. Retry to finish.',
            },
          }
        : {}),
    } satisfies BookmarkSyncResponse);
  } catch (error) {
    const errorMessage = sanitizeError(error);
    auditLog('bookmark_sync_error', req.user?.userId || 'unknown', {
      error: errorMessage,
    });

    console.error('Bookmark sync error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to sync bookmarks',
    });
  }
});

/**
 * Completes optional work after the base Notion sync has already succeeded.
 * The extension persists and retries this idempotent request across MV3 worker restarts.
 */
router.post('/enrich', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    const { items, aiBatchEligible }: BookmarkSyncEnrichmentRequest = req.body || {};
    if (!Array.isArray(items) || items.length === 0 || items.length > 2_000) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Enrichment items must contain between 1 and 2000 entries',
      });
    }
    const validItems = items.filter(
      (item): item is BookmarkSyncEnrichmentItem =>
        !!item &&
        typeof item.title === 'string' &&
        typeof item.url === 'string' &&
        /^https?:\/\//i.test(item.url) &&
        typeof item.syncId === 'string' &&
        !!item.syncId.trim() &&
        typeof item.notionPageId === 'string' &&
        !!item.notionPageId.trim() &&
        (item.action === 'created' || item.action === 'updated')
    );
    if (validItems.length !== items.length) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid enrichment item' });
    }

    const userData = await userPrisma.find(userId);
    if (!userData?.notionDataSourceId || !userData.notionAccessToken) {
      return res.status(400).json({
        error: 'Database Not Configured',
        message: 'Reconnect Notion before completing sync enrichment',
      });
    }
    const dataSourceId = userData.notionDataSourceId;
    const { descriptionPropertyId } = await notionService.getAiTemplateProperties(
      dataSourceId,
      userData.notionAccessToken
    );
    const descriptionBySyncId = new Map<string, string>();
    let generated = 0;
    let alreadyPresent = 0;
    let unavailable = 0;
    let targetSkipped = 0;
    let failed = 0;

    const batches = createBatches(validItems, config.descriptionExtraction.batchSize);
    for (let index = 0; index < batches.length; index++) {
      await Promise.all(
        batches[index].map(async (item) => {
          try {
            const page = await notionService.getPage(item.notionPageId, userData.notionAccessToken);
            if (!belongsToSyncTarget(page, dataSourceId, userData.notionDatabaseId)) {
              targetSkipped += 1;
              return;
            }
            const currentDescription = readRichTextProperty(page, descriptionPropertyId);
            if (currentDescription) {
              descriptionBySyncId.set(item.syncId, currentDescription);
              alreadyPresent += 1;
              return;
            }
            const extracted = await descriptionExtractor.extractFromUrl(item.url);
            if (!extracted.success || !extracted.description) {
              descriptionBySyncId.set(item.syncId, '');
              unavailable += 1;
              return;
            }
            // Re-read after the network fetch so a description entered by the
            // user while enrichment was running always wins.
            const latestPage = await notionService.getPage(
              item.notionPageId,
              userData.notionAccessToken
            );
            if (!belongsToSyncTarget(latestPage, dataSourceId, userData.notionDatabaseId)) {
              targetSkipped += 1;
              return;
            }
            const latestDescription = readRichTextProperty(latestPage, descriptionPropertyId);
            if (latestDescription) {
              descriptionBySyncId.set(item.syncId, latestDescription);
              alreadyPresent += 1;
              return;
            }
            await notionService.updatePage(
              item.notionPageId,
              {
                [descriptionPropertyId]: {
                  rich_text: [{ type: 'text', text: { content: extracted.description } }],
                },
              },
              userData.notionAccessToken
            );
            descriptionBySyncId.set(item.syncId, extracted.description);
            generated += 1;
          } catch (error) {
            failed += 1;
            console.warn('[Bookmark Enrichment] Item failed:', sanitizeError(error));
          }
        })
      );
      if (index < batches.length - 1) await sleep(config.descriptionExtraction.batchDelayMs);
    }

    const summary = {
      total: validItems.length,
      generated,
      alreadyPresent,
      unavailable,
      targetSkipped,
      failed,
    };
    if (failed > 0) {
      auditLog('bookmark_sync_enrichment_retry', userId, summary);
      return res.status(503).json({
        error: 'Enrichment Incomplete',
        message: 'Some enrichment work could not be completed and can be retried safely',
        summary,
      });
    }

    let aiBatch: AiBatchPlan['aiBatch'];
    let aiPlanning: AiBatchPlan['aiPlanning'] = {
      status: 'not_eligible',
    };
    try {
      const planned = await planDeferredAiBatch(
        userId,
        userData,
        dataSourceId,
        validItems,
        descriptionBySyncId,
        aiBatchEligible
      );
      aiBatch = planned.aiBatch;
      aiPlanning = planned.aiPlanning;
    } catch (error) {
      aiPlanning = { status: 'failed' };
      console.error('[Bookmark Enrichment] AI planning failed:', sanitizeError(error));
    }

    auditLog('bookmark_sync_enrichment_success', userId, summary);
    return res.json({
      success: true,
      summary,
      aiBatch,
      aiPlanning,
    } satisfies BookmarkSyncEnrichmentResponse);
  } catch (error) {
    const message = sanitizeError(error);
    auditLog('bookmark_sync_enrichment_error', userId, { error: message });
    console.error('[Bookmark Enrichment] Failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to complete bookmark enrichment',
    });
  }
});
/**
 * Get Bookmark Statistics
 * Returns statistics about user's synced bookmarks
 */
router.get(
  '/stats/:databaseId',
  validateSession,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const userData = await userPrisma.find(userId);
      const { databaseId } = req.params;

      if (!userData) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'User data not found',
        });
      }

      // Resolve to data source and query for statistics
      const dataSourceId = await notionService.getPrimaryDataSourceId(
        databaseId,
        userData.notionAccessToken
      );
      const data = await notionService.queryDataSource(
        dataSourceId,
        userData.notionAccessToken,
        undefined,
        [{ property: 'Created', direction: 'descending' }]
      );

      const bookmarks = data.results || [];
      const folderCounts = new Map<string, number>();
      const tagCounts = new Map<string, number>();

      bookmarks.forEach((bookmark: any) => {
        const { folder, tags } = extractNotionPageFolderAndTags(bookmark);
        folderCounts.set(folder, (folderCounts.get(folder) || 0) + 1);

        tags.forEach((tag) => {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        });
      });

      // lastActivity is updated by DB writes elsewhere; no-op here

      const stats = {
        total: bookmarks.length,
        folders: Object.fromEntries(folderCounts),
        tags: Object.fromEntries(tagCounts),
        lastSync: bookmarks[0]?.created_time || null,
        oldestBookmark: bookmarks[bookmarks.length - 1]?.created_time || null,
      };

      auditLog('bookmark_stats_fetch', userId, {
        databaseId,
        totalBookmarks: stats.total,
        folderCount: folderCounts.size,
        tagCount: tagCounts.size,
      });

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      const errorMessage = sanitizeError(error);
      auditLog('bookmark_stats_error', req.user?.userId || 'unknown', {
        error: errorMessage,
      });

      console.error('Bookmark stats error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch bookmark statistics',
      });
    }
  }
);

export default router;
