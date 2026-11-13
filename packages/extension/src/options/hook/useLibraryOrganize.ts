import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAiProvider } from '@bookmark-assistant/types';
import { AI_PROVIDER_HOST_PERMISSIONS } from '../../ai/providers';
import type { OrganizeErrorCode, OrganizeKeySummary } from '../../background/library-organize';
import {
  ORGANIZE_CATEGORY_IDS,
  categoryOfNewFolderId,
  chunkOrganizeItems,
  newCategoryFolderId,
  organizeCategoryName,
  type OrganizeBatch,
  type OrganizeCategoryId,
  type OrganizeCategoryProposal,
  type OrganizeFolderMap,
  type OrganizeScope,
} from '../../core';
import {
  applyOrganizeMoves,
  readOrganizeUndo,
  undoOrganizeMoves,
} from '../../library/organize-apply';
import type { OrganizeTask } from '../../runtime/organize';
import { Messages, ORGANIZE_MESSAGE_TIMEOUT_MS, sendMessage } from '../../utils/message';

export type OrganizePhase =
  | 'loading'
  | 'setup'
  | 'ready'
  | 'running'
  | 'preview'
  | 'applying'
  | 'done';

export interface ReviewedProposal extends OrganizeCategoryProposal {
  selected: boolean;
}

/** The library as Options has it; used to sample folders and resolve category targets. */
export interface OrganizeLibrary {
  bookmarks: Array<{ parentId?: string; title: string }>;
  folders: Array<{ id: string; parentId?: string; path: string }>;
}

interface OrganizePlan {
  folderMap: OrganizeFolderMap;
  targets: Record<OrganizeCategoryId, string>;
  parentOf: Map<string, string | undefined>;
}

export interface OrganizeTargetOption {
  value: string;
  label: string;
  /** A category folder that does not exist yet and is created when applied. */
  isNew: boolean;
  /** One of the eight category targets, listed before the other folders. */
  isCategory: boolean;
}

/** Provider errors plus local failures that leave Chrome bookmarks as they were. */
export type OrganizePanelError =
  | OrganizeErrorCode
  | 'apply_failed'
  | 'undo_failed'
  | 'key_delete_failed';

const RATE_LIMIT_DEFAULT_PAUSE_MS = 5_000;
const RATE_LIMIT_MAX_PAUSE_MS = 15_000;

/** These need the user to change the key or plan; retrying the next batch cannot help. */
const FATAL_ERRORS = new Set<OrganizeErrorCode>([
  'invalid_request',
  'not_configured',
  'permission_required',
  'invalid_api_key',
  'insufficient_quota',
  'model_access',
]);

export type BatchSender = (batch: OrganizeBatch) => Promise<{
  success: boolean;
  proposals?: OrganizeCategoryProposal[];
  errorCode?: OrganizeErrorCode;
  retryAfterMs?: number;
}>;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Runs batches one at a time so a failed batch does not discard the others.
 * Unfinished batches, including ones skipped by cancelling, stay retryable.
 */
export async function runOrganizeBatches(
  batches: OrganizeBatch[],
  send: BatchSender,
  options: {
    isCancelled: () => boolean;
    onProgress: (completed: number) => void;
    sleep?: (milliseconds: number) => Promise<unknown>;
  }
): Promise<{
  proposals: OrganizeCategoryProposal[];
  failedBatches: OrganizeBatch[];
  fatalError?: OrganizeErrorCode;
}> {
  const proposals: OrganizeCategoryProposal[] = [];
  const failedBatches: OrganizeBatch[] = [];
  const sleep = options.sleep ?? wait;
  for (const [index, batch] of batches.entries()) {
    if (options.isCancelled()) {
      return { proposals, failedBatches: [...failedBatches, ...batches.slice(index)] };
    }
    let response: Awaited<ReturnType<BatchSender>>;
    try {
      response = await send(batch);
    } catch {
      response = { success: false, errorCode: 'provider_request_failed' };
    }
    if (response.success) {
      proposals.push(...(response.proposals ?? []));
    } else {
      const code = response.errorCode ?? 'provider_request_failed';
      if (FATAL_ERRORS.has(code)) {
        return {
          proposals,
          failedBatches: [...failedBatches, ...batches.slice(index)],
          fatalError: code,
        };
      }
      failedBatches.push(batch);
      if (code === 'rate_limited' && index < batches.length - 1) {
        await sleep(
          Math.min(response.retryAfterMs ?? RATE_LIMIT_DEFAULT_PAUSE_MS, RATE_LIMIT_MAX_PAUSE_MS)
        );
      }
    }
    options.onProgress(index + 1);
  }
  return { proposals, failedBatches };
}

export function useLibraryOrganize(
  scope: OrganizeScope,
  uiLanguage: string,
  library: OrganizeLibrary
) {
  const [phase, setPhase] = useState<OrganizePhase>('loading');
  const [key, setKey] = useState<OrganizeKeySummary | null>(null);
  const [errorCode, setErrorCode] = useState<OrganizePanelError>();
  const [undoing, setUndoing] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [proposals, setProposals] = useState<ReviewedProposal[]>([]);
  const [failedBatches, setFailedBatches] = useState<OrganizeBatch[]>([]);
  const [result, setResult] = useState<{ moved: number; skipped: number }>();
  const [undoResult, setUndoResult] = useState<{ restored: number; skipped: number }>();
  const [canUndo, setCanUndo] = useState(false);
  const taskId = useRef<string>();
  const taskRevision = useRef<string>();
  const [plan, setPlan] = useState<OrganizePlan>();

  const receiveTask = useCallback((task: OrganizeTask) => {
    taskId.current = task.id;
    taskRevision.current = task.revision;
    const state = task.state;
    setProgress({ completed: state.completed, total: state.total });
    if (task.status === 'stale') {
      setProposals([]);
      setFailedBatches([]);
      setErrorCode('not_configured');
      setPhase('ready');
      return;
    }
    if (state.folderMap && state.targets)
      setPlan({
        folderMap: state.folderMap,
        targets: state.targets,
        parentOf: new Map(task.input.parents),
      });
    setProposals((previous) =>
      state.proposals.map((proposal) => {
        const reviewed = previous.find((item) => item.bookmarkId === proposal.bookmarkId);
        return reviewed ?? { ...proposal, selected: proposal.confident };
      })
    );
    const active = task.status === 'pending' || task.status === 'running';
    setFailedBatches(
      active || task.status === 'succeeded'
        ? []
        : chunkOrganizeItems(task.input.scope.items)
            .slice(state.cursor)
            .map((items) => ({ items }))
    );
    setErrorCode(
      task.errorCode
        ? task.errorCode === 'interrupted' || task.errorCode === 'task_failed'
          ? 'provider_request_failed'
          : (task.errorCode as OrganizeErrorCode)
        : undefined
    );
    setPhase(active ? 'running' : 'preview');
  }, []);

  const refreshUndo = useCallback(async () => {
    setCanUndo(Boolean((await readOrganizeUndo())?.entries.length));
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const response = await sendMessage({ type: Messages.ORGANIZE_KEY_GET }).catch(
        () => undefined
      );
      if (!active) return;
      const stored = response?.success ? (response.key ?? null) : null;
      setKey(stored);
      setPhase(stored ? 'ready' : 'setup');
      const restored = await sendMessage({ type: Messages.ORGANIZE_TASK_GET }).catch(
        () => undefined
      );
      if (!active) return;
      if (restored?.success && restored.task) receiveTask(restored.task);
      await refreshUndo();
    })();
    return () => {
      active = false;
    };
  }, [refreshUndo, receiveTask]);

  useEffect(() => {
    if (phase !== 'running') return;
    let active = true;
    let polling = false;
    const timer = setInterval(() => {
      if (polling || !taskId.current) return;
      polling = true;
      void sendMessage({ type: Messages.ORGANIZE_TASK_GET, id: taskId.current })
        .then((response) => {
          if (active && response.success && response.task) receiveTask(response.task);
        })
        .catch(() => {
          if (active) setErrorCode('service_unavailable');
        })
        .finally(() => {
          polling = false;
        });
    }, 1_000);
    // Unmount stops observation only. The background owns task cancellation.
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [phase, receiveTask]);

  /** Must be called synchronously from the click so Chrome can show its permission prompt. */
  const saveKey = (provider: string, apiKey: string) => {
    setErrorCode(undefined);
    if (!isAiProvider(provider)) return Promise.resolve(false);
    const permission = chrome.permissions.request({
      origins: [AI_PROVIDER_HOST_PERMISSIONS[provider]],
    });
    return (async () => {
      if (!(await permission.catch(() => false))) {
        setErrorCode('permission_required');
        return false;
      }
      const response = await sendMessage(
        { type: Messages.ORGANIZE_KEY_SAVE, provider, apiKey },
        { timeoutMs: ORGANIZE_MESSAGE_TIMEOUT_MS }
      ).catch(() => ({ success: false, errorCode: 'service_unavailable' as const }));
      if (!response.success || !('key' in response) || !response.key) {
        setErrorCode(response.errorCode ?? 'service_unavailable');
        return false;
      }
      setKey(response.key);
      setPhase('ready');
      return true;
    })();
  };

  const clearKey = async () => {
    setErrorCode(undefined);
    const response = await sendMessage({ type: Messages.ORGANIZE_KEY_DELETE }).catch(
      () => undefined
    );
    if (!response?.success) {
      setErrorCode('key_delete_failed');
      return;
    }
    setKey(null);
    setPhase('setup');
  };

  const changeKey = () => {
    setErrorCode(undefined);
    setPhase('setup');
  };

  const backToReady = () => {
    setErrorCode(undefined);
    setPhase('ready');
  };

  const start = async () => {
    setErrorCode(undefined);
    setProposals([]);
    setPhase('running');
    const counts = new Map<string, number>();
    for (const bookmark of library.bookmarks) {
      if (bookmark.parentId)
        counts.set(bookmark.parentId, (counts.get(bookmark.parentId) ?? 0) + 1);
    }
    const response = await sendMessage({
      type: Messages.ORGANIZE_TASK_START,
      input: {
        scope,
        uiLanguage,
        parents: library.folders.map((folder) => [folder.id, folder.parentId]),
        folderCounts: [...counts],
      },
    }).catch(() => undefined);
    if (response?.success && response.task) {
      receiveTask(response.task);
    } else {
      setErrorCode(response && !response.success ? response.errorCode : 'service_unavailable');
      setPhase('ready');
    }
  };

  /** Drops a finished result so it is not restored again, and returns to a new run. */
  const discard = async () => {
    setErrorCode(undefined);
    const id = taskId.current;
    if (id) {
      const response = await sendMessage({ type: Messages.ORGANIZE_TASK_DISMISS, id }).catch(
        () => undefined
      );
      if (!response?.success) {
        setErrorCode(response?.errorCode ?? 'service_unavailable');
        return;
      }
    }
    taskId.current = undefined;
    taskRevision.current = undefined;
    setProposals([]);
    setFailedBatches([]);
    setPlan(undefined);
    setProgress({ completed: 0, total: 0 });
    setPhase(key ? 'ready' : 'setup');
  };

  const retryFailed = async () => {
    if (!taskId.current) return;
    const response = await sendMessage({
      type: Messages.ORGANIZE_TASK_RETRY,
      id: taskId.current,
    }).catch(() => undefined);
    if (response?.success && response.task) receiveTask(response.task);
    else setErrorCode(response && !response.success ? response.errorCode : 'service_unavailable');
  };

  const newFolderTitles = useMemo<Record<string, string>>(
    () =>
      Object.fromEntries(
        ORGANIZE_CATEGORY_IDS.map((category) => [
          newCategoryFolderId(category),
          organizeCategoryName(category, uiLanguage),
        ])
      ),
    [uiLanguage]
  );

  const newFolderTitle = (folderId: string) => {
    const category = categoryOfNewFolderId(folderId);
    return category ? organizeCategoryName(category, uiLanguage) : undefined;
  };

  /** Category targets first, then every other folder, for the per-bookmark target menu. */
  const targetOptions = (barPath: string): OrganizeTargetOption[] => {
    const pathOf = new Map(scope.folders.map((folder) => [folder.id, folder.path]));
    const categoryTargets = plan
      ? ORGANIZE_CATEGORY_IDS.map((category) => plan.targets[category])
      : [];
    const options = categoryTargets.map((folderId) => {
      const title = newFolderTitle(folderId);
      return title
        ? { value: folderId, label: `${barPath} / ${title}`, isNew: true, isCategory: true }
        : {
            value: folderId,
            label: pathOf.get(folderId) ?? folderId,
            isNew: false,
            isCategory: true,
          };
    });
    const listed = new Set(categoryTargets);
    for (const folder of scope.folders) {
      if (!listed.has(folder.id))
        options.push({ value: folder.id, label: folder.path, isNew: false, isCategory: false });
    }
    return options;
  };

  const cancel = async () => {
    if (!taskId.current) return;
    const response = await sendMessage({
      type: Messages.ORGANIZE_TASK_CANCEL,
      id: taskId.current,
    }).catch(() => undefined);
    if (response?.success && response.task) receiveTask(response.task);
    else setErrorCode('service_unavailable');
  };

  const updateProposal = (bookmarkId: string, changes: Partial<ReviewedProposal>) => {
    setProposals((current) =>
      current.map((proposal) =>
        proposal.bookmarkId === bookmarkId ? { ...proposal, ...changes } : proposal
      )
    );
  };

  const selectAll = (selected: boolean) => {
    setProposals((current) => current.map((proposal) => ({ ...proposal, selected })));
  };

  const apply = async () => {
    if (undoing || phase === 'applying') return;
    setErrorCode(undefined);
    setUndoResult(undefined);
    setPhase('applying');
    const id = taskId.current;
    const revision = taskRevision.current;
    const response = id
      ? await sendMessage({ type: Messages.ORGANIZE_TASK_GET, id }).catch(() => undefined)
      : undefined;
    if (!response?.success) {
      setErrorCode(response?.errorCode ?? 'service_unavailable');
      setPhase('preview');
      return;
    }
    const task = response.task;
    if (
      !task ||
      task.id !== id ||
      task.revision !== revision ||
      !['succeeded', 'failed', 'cancelled'].includes(task.status)
    ) {
      setProposals([]);
      setFailedBatches([]);
      setErrorCode('not_configured');
      setPhase('ready');
      return;
    }
    const moves = proposals
      .filter((proposal) => proposal.selected && proposal.toFolderId !== proposal.fromParentId)
      .map(({ bookmarkId, fromParentId, toFolderId }) => ({
        bookmarkId,
        fromParentId,
        toFolderId,
      }));
    try {
      setResult(await applyOrganizeMoves(moves, { newFolderTitles }));
      // The moves are done and journaled for Undo. Dismissing only stops this result from
      // being restored; if it fails, the next opening shows it again with Discard available.
      await sendMessage({ type: Messages.ORGANIZE_TASK_DISMISS, id: task.id }).catch(
        () => undefined
      );
      setPhase('done');
    } catch {
      // Moves already made are journaled, so Undo still covers them.
      setErrorCode('apply_failed');
      setPhase('preview');
    } finally {
      await refreshUndo().catch(() => undefined);
    }
  };

  const undo = async () => {
    if (undoing || phase === 'applying') return;
    setUndoing(true);
    setErrorCode(undefined);
    try {
      setUndoResult(await undoOrganizeMoves());
    } catch {
      setErrorCode('undo_failed');
    } finally {
      await refreshUndo().catch(() => undefined);
      setUndoing(false);
    }
  };

  return {
    phase,
    key,
    errorCode,
    progress,
    proposals,
    failedBatches,
    result,
    undoResult,
    canUndo,
    undoing,
    saveKey,
    clearKey,
    changeKey,
    backToReady,
    start,
    discard,
    retryFailed,
    targetOptions,
    newFolderTitles,
    cancel,
    updateProposal,
    selectAll,
    apply,
    undo,
  };
}
