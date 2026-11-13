import {
  categoryOfFolder,
  chunkOrganizeItems,
  planCategoryMoves,
  resolveCategoryTargets,
  sampleOrganizeFolders,
  toShareableBookmarkUrl,
  ORGANIZE_MAX_ITEMS,
  ORGANIZE_MAX_FOLDERS,
  type OrganizeScope,
  type OrganizeFolderMap,
  type OrganizeCategoryId,
  type OrganizeCategoryProposal,
} from '../core';
import {
  OrganizeError,
  readOrganizeCredentialRevision,
  runAssignBatch,
  runFolderMap,
  type OrganizeErrorCode,
} from '../background/library-organize';
import type { MessageRequest, MessageResponse } from '../utils/message';
import { type TaskRuntime, type TaskRecord } from './index';
import { startRuntime } from './chrome';

export interface OrganizeTaskInput {
  scope: OrganizeScope;
  uiLanguage: string;
  parents: Array<[string, string | undefined]>;
  folderCounts: Array<[string, number]>;
}
export interface OrganizeTaskState {
  folderMap?: OrganizeFolderMap;
  targets?: Record<OrganizeCategoryId, string>;
  proposals: OrganizeCategoryProposal[];
  cursor: number;
  completed: number;
  total: number;
}
export type OrganizeTask = TaskRecord<OrganizeTaskInput, OrganizeTaskState>;
export type OrganizeTaskResponse =
  | { success: true; task: OrganizeTask | null }
  | { success: false; errorCode: OrganizeErrorCode };

const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 4096;
const invalid = (): never => {
  throw new OrganizeError('invalid_request');
};

/** Whitelist only shareable fields; credentials and raw URLs never enter the queue. */
export function prepareOrganizeTaskInput(raw: unknown): OrganizeTaskInput {
  const value = raw as OrganizeTaskInput | undefined;
  if (
    !value?.scope ||
    !Array.isArray(value.scope.items) ||
    value.scope.items.length > ORGANIZE_MAX_ITEMS ||
    !Array.isArray(value.scope.folders) ||
    value.scope.folders.length > ORGANIZE_MAX_FOLDERS ||
    !text(value.uiLanguage) ||
    !Array.isArray(value.parents) ||
    !Array.isArray(value.folderCounts) ||
    value.parents.length > 20_000 ||
    value.folderCounts.length > 20_000
  )
    return invalid();
  const items = value.scope.items.flatMap((item) => {
    if (!item || ![item.id, item.parentId, item.title, item.url, item.folderPath].every(text))
      return invalid();
    const url = toShareableBookmarkUrl(item.url);
    return url
      ? [
          {
            id: item.id,
            parentId: item.parentId,
            title: item.title.slice(0, 200),
            url,
            folderPath: item.folderPath,
          },
        ]
      : [];
  });
  if (!items.length) return invalid();
  const folders = value.scope.folders.map((folder) => {
    if (
      !folder ||
      !text(folder.id) ||
      !text(folder.path) ||
      (folder.parentId !== undefined && !text(folder.parentId))
    )
      return invalid();
    return { id: folder.id, parentId: folder.parentId, path: folder.path };
  });
  const parents = value.parents.map((entry): [string, string | undefined] => {
    if (!Array.isArray(entry) || !text(entry[0]) || (entry[1] !== undefined && !text(entry[1])))
      return invalid();
    return [entry[0], entry[1]];
  });
  const folderCounts = value.folderCounts.map((entry): [string, number] => {
    if (!Array.isArray(entry) || !text(entry[0]) || !Number.isInteger(entry[1]) || entry[1] < 0)
      return invalid();
    return [entry[0], entry[1]];
  });
  return {
    scope: { items, folders, totalCandidates: items.length, excludedCount: 0 },
    uiLanguage: value.uiLanguage.slice(0, 32),
    parents,
    folderCounts,
  };
}

const RETRYABLE = new Set<OrganizeErrorCode>([
  'rate_limited',
  'service_unavailable',
  'provider_request_failed',
  'invalid_provider_response',
  'invalid_response',
]);

export function registerOrganizeTask(runtime: TaskRuntime) {
  runtime.register<OrganizeTaskInput, OrganizeTaskState>('organize', {
    initialize: (input) => ({
      proposals: [],
      cursor: 0,
      completed: 0,
      total: chunkOrganizeItems(input.scope.items).length + 1,
    }),
    isCurrent: async (job) => (await readOrganizeCredentialRevision()) === job.revision,
    async step(job) {
      const { input, state } = job;
      if (!state.folderMap) {
        const roots = new Set(
          input.parents.filter(([, parent]) => !parent || parent === '0').map(([id]) => id)
        );
        const { folderMap } = await runFolderMap(
          { folders: sampleOrganizeFolders(input.scope.folders, input.scope.items, roots) },
          fetch,
          job.revision
        );
        const targets = resolveCategoryTargets(
          folderMap,
          input.scope.folders,
          new Map(input.folderCounts)
        );
        return { state: { ...state, folderMap, targets, completed: 1 }, done: false };
      }
      const batches = chunkOrganizeItems(input.scope.items);
      const items = batches[state.cursor];
      if (!items) return { state, done: true };
      const parentOf = new Map(input.parents);
      const { assignments } = await runAssignBatch(
        items.map((item) => ({
          ...item,
          currentCategory: categoryOfFolder(item.parentId, state.folderMap!, parentOf),
        })),
        input.uiLanguage,
        fetch,
        job.revision
      );
      const proposals = planCategoryMoves(
        assignments,
        items,
        state.folderMap,
        state.targets!,
        parentOf
      );
      return {
        state: {
          ...state,
          proposals: [...state.proposals, ...proposals],
          cursor: state.cursor + 1,
          completed: state.completed + 1,
        },
        done: state.cursor + 1 >= batches.length,
      };
    },
    retry: (error) =>
      error instanceof OrganizeError
        ? {
            code: error.code,
            retryAfterMs: error.retryAfterMs,
            retryable: RETRYABLE.has(error.code),
          }
        : { code: 'provider_request_failed' },
  });
}

export function createOrganizeTaskHandlers(runtime: TaskRuntime) {
  const wake = () => {
    void startRuntime(runtime).catch(() => undefined);
  };
  async function respond(
    action: () => Promise<TaskRecord | undefined | null>
  ): Promise<OrganizeTaskResponse> {
    try {
      return { success: true, task: ((await action()) ?? null) as OrganizeTask | null };
    } catch (error) {
      return {
        success: false,
        errorCode: error instanceof OrganizeError ? error.code : 'service_unavailable',
      };
    }
  }
  async function own(id: unknown) {
    if (typeof id !== 'string') return invalid();
    const job = await runtime.get(id);
    if (!job || job.type !== 'organize') return invalid();
    return job;
  }
  return {
    ORGANIZE_TASK_START: (
      request: MessageRequest<'ORGANIZE_TASK_START'>
    ): Promise<MessageResponse<'ORGANIZE_TASK_START'>> =>
      respond(async () => {
        const input = prepareOrganizeTaskInput(request.input);
        const revision = await readOrganizeCredentialRevision();
        if (!revision) throw new OrganizeError('not_configured');
        const job = await runtime.submit({
          type: 'organize',
          input,
          revision,
          dedupeKey: 'organize',
        });
        wake();
        return job;
      }),
    ORGANIZE_TASK_GET: (request: MessageRequest<'ORGANIZE_TASK_GET'>) =>
      respond(async () => {
        const job = request.id
          ? await own(request.id)
          : (await runtime.list('organize')).sort((a, b) => b.createdAt - a.createdAt)[0];
        // 已应用或放弃的结果只能按编号读取，不再作为“上次的整理”恢复。
        if (!job || (!request.id && job.dismissed)) return null;
        if ((await readOrganizeCredentialRevision()) !== job.revision) {
          await runtime.cancel(job.id);
          // 密钥已更换：只提示一次，之后打开面板直接回到可开始状态。
          await runtime.dismiss(job.id);
          return {
            ...job,
            status: 'stale',
            errorCode: 'not_configured',
            state: { ...(job.state as OrganizeTaskState), proposals: [] },
          };
        }
        return job;
      }),
    ORGANIZE_TASK_CANCEL: (request: MessageRequest<'ORGANIZE_TASK_CANCEL'>) =>
      respond(async () => {
        await own(request.id);
        return runtime.cancel(request.id);
      }),
    ORGANIZE_TASK_DISMISS: (request: MessageRequest<'ORGANIZE_TASK_DISMISS'>) =>
      respond(async () => {
        await own(request.id);
        return runtime.dismiss(request.id);
      }),
    ORGANIZE_TASK_RETRY: (request: MessageRequest<'ORGANIZE_TASK_RETRY'>) =>
      respond(async () => {
        await own(request.id);
        const job = await runtime.retry(request.id);
        wake();
        return job;
      }),
  };
}
