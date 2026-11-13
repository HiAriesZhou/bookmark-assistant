import type { LinkItem } from '@bookmark-assistant/types';
import { isTaskActive, type TaskRecord, type TaskRuntime } from '../runtime';
import {
  createSyncStepper,
  initialSyncState,
  type SyncTaskState,
} from '../destinations/notion/sync-task-steps';
import { notionApi } from '../destinations/notion/notion-api';
import { createDescriptionHistory } from '../destinations/notion/description-history';
import { fillMissingDescription } from '../destinations/notion/description-write';
import { getNotionErrorStatus, getNotionRetryDelayMs } from '../destinations/notion/core';
import {
  assertDestinationContextCurrent,
  isDestinationContextCurrent,
  readDestinationContext,
  withCurrentDestination,
  type DestinationContext,
} from '../utils/destination-state';
import { enrichLinkDescriptions } from './link-description';
import { recordConnectionFailure } from './connection-health';
import { DASHBOARD_SYNC_SUMMARY_KEY } from './dashboard';

export const NOTION_SYNC_TASK = 'notion-sync';
export const NOTION_SYNC_TASK_KEY = 'notion_sync_task_id';
export interface NotionSyncInput {
  databaseId: string;
  links: LinkItem[];
  trigger: 'manual' | 'auto';
  fingerprint?: string;
  payloadVersion?: number;
  capture?: boolean;
}
export type NotionSyncTask = TaskRecord<NotionSyncInput, SyncTaskState>;
const revisionOf = (context: DestinationContext) => context.revision ?? 'legacy-local-connection';
const taskLocks = new WeakMap<TaskRuntime, Promise<unknown>>();
function withSyncTaskLock<T>(runtime: TaskRuntime, operation: () => Promise<T>): Promise<T> {
  const next = (taskLocks.get(runtime) ?? Promise.resolve()).then(operation, operation);
  taskLocks.set(
    runtime,
    next.catch(() => undefined)
  );
  return next;
}
async function connectionTasks(runtime: TaskRuntime, context: DestinationContext) {
  return ((await runtime.list(NOTION_SYNC_TASK)) as NotionSyncTask[])
    .filter(
      (job) => job.revision === revisionOf(context) && job.input.databaseId === context.databaseId
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function contextFor(job: NotionSyncTask): Promise<DestinationContext> {
  const context = await readDestinationContext();
  if (
    !context.token ||
    context.databaseId !== job.input.databaseId ||
    revisionOf(context) !== job.revision
  )
    throw new Error('DESTINATION_CHANGED');
  return context;
}

export function registerNotionSyncTask(runtime: TaskRuntime) {
  const steppers = new Map<string, ReturnType<typeof createSyncStepper>>();
  runtime.register<NotionSyncInput, SyncTaskState>(NOTION_SYNC_TASK, {
    initialize: initialSyncState,
    isCurrent: async (job) => {
      try {
        await contextFor(job);
        return true;
      } catch {
        return false;
      }
    },
    step: async (job) => {
      let stepper = steppers.get(job.id);
      if (!stepper) {
        const context = await contextFor(job);
        const history = createDescriptionHistory(context);
        const assertCurrent = () => assertDestinationContextCurrent(context);
        stepper = createSyncStepper({
          api: notionApi,
          token: context.token!,
          assertCurrent,
          protectDescription: history.protect,
          canDescribe: async (pageId) => !(await history.get(pageId)),
          enrich: async (item) =>
            (await enrichLinkDescriptions([item], () => isDestinationContextCurrent(context)))[0],
          fillDescription: async (pageId, text) => {
            await fillMissingDescription(pageId, text, {
              history,
              assertCurrent,
              api: {
                readDescription: (id) => notionApi.readDescription(id, context.token!),
                writeDescription: (id, property, value) =>
                  notionApi.writeDescription(id, property, value, context.token!),
              },
            });
          },
        });
        steppers.set(job.id, stepper);
      }
      const result = await stepper(job.input.links, job.input.databaseId, job.state);
      return result;
    },
    retry: (error) => {
      const message = error instanceof Error ? error.message : '';
      if (message === 'NOTION_WRITE_UNCERTAIN')
        return { code: 'notion_write_uncertain', retryable: false };
      const status = getNotionErrorStatus(error);
      if (status === 401 || status === 403)
        return { code: 'notion_reconnect_required', retryable: false };
      if (status && status >= 400 && status < 500 && status !== 429)
        return { code: 'notion_request_rejected', retryable: false };
      return {
        code: status === 429 ? 'notion_rate_limited' : 'notion_request_failed',
        retryAfterMs: getNotionRetryDelayMs(error, 0),
      };
    },
    onSettled: async (job) => {
      steppers.delete(job.id);
      await withSyncTaskLock(runtime, () => settleNotionSync(job, runtime));
    },
  });
}

async function settleNotionSync(job: NotionSyncTask, runtime: TaskRuntime) {
  const current = await runtime.get(job.id);
  if (
    !current ||
    current.version !== job.version ||
    current.status !== job.status ||
    isTaskActive(current)
  )
    return;
  let context: DestinationContext;
  try {
    context = await contextFor(job);
  } catch {
    return;
  }
  const stored = await chrome.storage.local.get(NOTION_SYNC_TASK_KEY);
  const active = (await connectionTasks(runtime, context)).filter(isTaskActive);
  const progress = {
    sync_in_progress: active.length > 0,
    sync_started_at: active.length ? Math.min(...active.map((task) => task.createdAt)) : null,
    sync_trigger: active[0]?.input.trigger ?? null,
  };
  if (stored[NOTION_SYNC_TASK_KEY] !== job.id) {
    await withCurrentDestination(context, () => chrome.storage.local.set(progress));
    return;
  }
  const succeeded = job.status === 'succeeded';
  const total = job.input.links.length;
  const completedAt = new Date(job.updatedAt).toISOString();
  const syncError =
    job.errorCode === 'notion_write_uncertain'
      ? 'A Notion write was interrupted. Its result could not be confirmed. Check the destination before retrying.'
      : job.errorCode === 'notion_reconnect_required'
        ? 'Reconnect Notion to continue syncing.'
        : 'Sync stopped. Retry to continue from saved progress.';
  if (job.errorCode === 'notion_reconnect_required') {
    await recordConnectionFailure(context, { status: 401 });
  }
  await withCurrentDestination(context, () =>
    chrome.storage.local.set({
      ...progress,
      last_sync_error: succeeded ? null : syncError,
      ...(succeeded ? { last_sync: completedAt, last_sync_summary: null } : {}),
      ...(succeeded && !job.input.capture && job.input.fingerprint && !job.state.descriptionFailures
        ? {
            last_sync_fingerprint: job.input.fingerprint,
            last_sync_payload_version: job.input.payloadVersion,
            last_sync_count: total,
          }
        : {}),
      [DASHBOARD_SYNC_SUMMARY_KEY]: {
        result: succeeded ? 'success' : job.state.completed ? 'partial_failure' : 'failed',
        completedAt,
        total,
        success: job.state.created + job.state.updated,
        failed: succeeded ? 0 : Math.max(1, total - job.state.completed),
        skipped: Math.max(0, job.state.completed - job.state.created - job.state.updated),
      },
    })
  );
}

/**
 * 启动时校正同步标记：升级前的同步或未完成的结算可能留下 sync_in_progress=true，
 * 但任务库里没有对应的进行中任务，界面会一直禁用同步。只在确实没有任务时清除。
 */
export function reconcileSyncProgress(runtime: TaskRuntime): Promise<void> {
  return withSyncTaskLock(runtime, async () => {
    const stored = await chrome.storage.local.get('sync_in_progress');
    if (stored.sync_in_progress !== true) return;
    const context = await readDestinationContext();
    if (context.token && context.databaseId) {
      const tasks = await connectionTasks(runtime, context);
      // 已结束但尚未结算的任务由 runner 结算时写回进度。
      if (tasks.some((job) => isTaskActive(job) || job.settled === false)) return;
    }
    await withCurrentDestination(context, () =>
      chrome.storage.local.set({
        sync_in_progress: false,
        sync_started_at: null,
        sync_trigger: null,
      })
    );
  });
}

/** 单次提交确认已保存任务；实际完成由 storage 状态通知界面。 */
export function submitNotionSync(
  runtime: TaskRuntime,
  context: DestinationContext,
  input: Omit<NotionSyncInput, 'databaseId'>
): Promise<string> {
  return withSyncTaskLock(runtime, () => submitSyncTask(runtime, context, input));
}

async function submitSyncTask(
  runtime: TaskRuntime,
  context: DestinationContext,
  input: Omit<NotionSyncInput, 'databaseId'>
) {
  await assertDestinationContextCurrent(context);
  if (!context.databaseId || !context.token) throw new Error('Notion is not connected');
  const tasks = await connectionTasks(runtime, context);
  const latestLibrary = tasks.find(
    (job) => !job.input.capture && !['cancelled', 'stale'].includes(job.status)
  );
  const latestCapture = input.capture
    ? tasks.find(
        (job) =>
          job.input.capture &&
          job.input.links[0]?.url === input.links[0]?.url &&
          !['cancelled', 'stale'].includes(job.status)
      )
    : undefined;
  const latest = input.capture ? latestCapture : latestLibrary;
  const previous = latest && latest.status !== 'succeeded' ? latest : undefined;
  if (previous?.errorCode === 'notion_write_uncertain')
    throw new Error(
      'An earlier Notion write has an unknown result. Check the destination before retrying.'
    );
  // 验证或认证拒绝的结果明确。按当前书签重新计划，
  // 不复用被拒绝的数据和已经消耗的首次创建许可。
  const replace =
    previous?.status === 'failed' &&
    ['notion_request_rejected', 'notion_reconnect_required'].includes(previous.errorCode ?? '');
  const job =
    (replace ? undefined : previous) ??
    (await runtime.submit({
      type: NOTION_SYNC_TASK,
      revision: revisionOf(context),
      dedupeKey: input.capture ? `capture:${input.links[0]?.url}` : 'library',
      input: { ...input, databaseId: context.databaseId },
    }));
  if (job.status === 'failed') {
    if (job.errorCode === 'notion_write_uncertain')
      throw new Error(
        'An earlier Notion write has an unknown result. Check the destination before retrying.'
      );
    await runtime.retry(job.id);
  }
  const primary =
    input.capture &&
    latestLibrary &&
    (isTaskActive(latestLibrary) || latestLibrary.status === 'failed')
      ? latestLibrary
      : job;
  await withCurrentDestination(context, () =>
    chrome.storage.local.set({
      [NOTION_SYNC_TASK_KEY]: primary.id,
      sync_in_progress: true,
      sync_started_at: primary.createdAt,
      sync_trigger: input.trigger,
      ...(primary.id === job.id ? { last_sync_error: null } : {}),
    })
  );
  return job.id;
}
