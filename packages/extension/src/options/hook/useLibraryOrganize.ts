import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAiProvider } from '@bookmark-assistant/types';
import { AI_PROVIDER_HOST_PERMISSIONS } from '../../ai/providers';
import type { OrganizeErrorCode, OrganizeKeySummary } from '../../background/library-organize';
import {
  ORGANIZE_CATEGORY_IDS,
  categoryOfFolder,
  categoryOfNewFolderId,
  chunkOrganizeItems,
  newCategoryFolderId,
  organizeCategoryName,
  planCategoryMoves,
  resolveCategoryTargets,
  sampleOrganizeFolders,
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

/** Root containers such as the bookmarks bar are never mapped to a category. */
function rootFolderIds(folders: OrganizeLibrary['folders']) {
  return new Set(
    folders.filter((folder) => !folder.parentId || folder.parentId === '0').map((f) => f.id)
  );
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
  const cancelled = useRef(false);
  const [plan, setPlan] = useState<OrganizePlan>();

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
      await refreshUndo();
    })();
    return () => {
      active = false;
      cancelled.current = true;
    };
  }, [refreshUndo]);

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

  const buildPlan = (folderMap: OrganizeFolderMap): OrganizePlan => {
    const directCounts = new Map<string, number>();
    for (const bookmark of library.bookmarks) {
      if (bookmark.parentId)
        directCounts.set(bookmark.parentId, (directCounts.get(bookmark.parentId) ?? 0) + 1);
    }
    return {
      folderMap,
      targets: resolveCategoryTargets(folderMap, scope.folders, directCounts),
      parentOf: new Map(library.folders.map((folder) => [folder.id, folder.parentId])),
    };
  };

  const runBatches = async (
    batches: OrganizeBatch[],
    previous: ReviewedProposal[],
    current: OrganizePlan,
    stepsDone = 0
  ) => {
    const total = stepsDone + batches.length;
    const outcome = await runOrganizeBatches(
      batches,
      async (batch) => {
        const response = await sendMessage(
          {
            type: Messages.ORGANIZE_ASSIGN_BATCH,
            items: batch.items.map((item) => ({
              ...item,
              currentCategory: categoryOfFolder(item.parentId, current.folderMap, current.parentOf),
            })),
            uiLanguage,
          },
          { timeoutMs: ORGANIZE_MESSAGE_TIMEOUT_MS }
        );
        if (!response.success) return response;
        return {
          success: true,
          proposals: planCategoryMoves(
            response.assignments ?? [],
            batch.items,
            current.folderMap,
            current.targets,
            current.parentOf
          ),
        };
      },
      {
        isCancelled: () => cancelled.current,
        onProgress: (completed) => setProgress({ completed: stepsDone + completed, total }),
      }
    );
    const reviewed = [
      ...previous,
      // Uncertain suggestions are shown but left unselected.
      ...outcome.proposals.map((proposal) => ({ ...proposal, selected: proposal.confident })),
    ];
    setProposals(reviewed);
    setFailedBatches(outcome.failedBatches);
    setErrorCode(outcome.fatalError);
    if (outcome.fatalError && !reviewed.length) {
      setPhase(outcome.fatalError === 'not_configured' ? 'setup' : 'ready');
      return;
    }
    setPhase('preview');
  };

  const start = async () => {
    cancelled.current = false;
    setErrorCode(undefined);
    const batches = chunkOrganizeItems(scope.items).map((items) => ({ items }));
    // Mapping existing folders is the first step of the progress bar.
    setProgress({ completed: 0, total: batches.length + 1 });
    setPhase('running');
    const request = {
      folders: sampleOrganizeFolders(
        scope.folders,
        // Folder examples cross the same provider boundary as classification items.
        scope.items,
        rootFolderIds(library.folders)
      ),
    };
    const mapped = await sendMessage(
      { type: Messages.ORGANIZE_MAP_FOLDERS, request },
      { timeoutMs: ORGANIZE_MESSAGE_TIMEOUT_MS }
    ).catch(() => ({ success: false, errorCode: 'provider_request_failed' as const }));
    if (!mapped.success || !('folderMap' in mapped) || !mapped.folderMap) {
      const code = mapped.errorCode ?? 'provider_request_failed';
      setErrorCode(code);
      setPhase(code === 'not_configured' ? 'setup' : 'ready');
      return;
    }
    if (cancelled.current) {
      setPhase('ready');
      return;
    }
    const current = buildPlan(mapped.folderMap);
    setPlan(current);
    setProgress({ completed: 1, total: batches.length + 1 });
    await runBatches(batches, [], current, 1);
  };

  const retryFailed = async () => {
    if (!plan) return;
    cancelled.current = false;
    setErrorCode(undefined);
    setProgress({ completed: 0, total: failedBatches.length });
    setPhase('running');
    await runBatches(failedBatches, proposals, plan);
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

  const cancel = () => {
    cancelled.current = true;
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
    if (undoing) return;
    setErrorCode(undefined);
    setUndoResult(undefined);
    setPhase('applying');
    const moves = proposals
      .filter((proposal) => proposal.selected && proposal.toFolderId !== proposal.fromParentId)
      .map(({ bookmarkId, fromParentId, toFolderId }) => ({
        bookmarkId,
        fromParentId,
        toFolderId,
      }));
    try {
      setResult(await applyOrganizeMoves(moves, { newFolderTitles }));
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
