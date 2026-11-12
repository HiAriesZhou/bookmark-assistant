import type { LinkItem } from '@bookmark-assistant/types';
import { diffLinkItems, type ExistingLinkRecord } from './core';
import type { NotionApi } from './notion-api';

type SyncApi = Pick<
  NotionApi,
  | 'verifyDatabaseAccess'
  | 'existingLinksPage'
  | 'buildPropertiesFromDataSource'
  | 'createPage'
  | 'updatePage'
  | 'findPageBySyncId'
  | 'findPageByUrlAndType'
>;
interface SyncWork {
  item: LinkItem;
  pageId?: string;
  update: boolean;
}
export interface SyncTaskState {
  phase: 'verify' | 'scan' | 'plan' | 'prepare' | 'write' | 'describe' | 'done';
  dataSourceId?: string;
  cursor?: string;
  scannedPages: number;
  records: ExistingLinkRecord[];
  work: SyncWork[];
  index: number;
  pageId?: string;
  writeNonce?: string;
  completed: number;
  created: number;
  updated: number;
  descriptionFailures: number;
}

export function initialSyncState(): SyncTaskState {
  return {
    phase: 'verify',
    scannedPages: 0,
    records: [],
    work: [],
    index: 0,
    completed: 0,
    created: 0,
    updated: 0,
    descriptionFailures: 0,
  };
}

export interface SyncStepDependencies {
  api: SyncApi;
  token?: string;
  assertCurrent(): Promise<void>;
  protectDescription(pageId: string): Promise<void>;
  canDescribe?(pageId: string): Promise<boolean>;
  enrich(item: LinkItem): Promise<LinkItem>;
  fillDescription(pageId: string, text: string): Promise<void>;
}

/** 每一步返回可持久保存的检查点，任何网络调用前后均检查连接。 */
export function createSyncStepper(deps: SyncStepDependencies) {
  // 写入意图持久保存后，只允许同一后台实例发起首次创建。
  const createPermits = new Set<string>();
  return async (links: LinkItem[], databaseId: string, state: SyncTaskState) => {
    await deps.assertCurrent();
    const next = await advanceSync(deps, createPermits, links, databaseId, state);
    await deps.assertCurrent();
    return { state: next, done: next.phase === 'done' };
  };
}

async function advanceSync(
  deps: SyncStepDependencies,
  permits: Set<string>,
  links: LinkItem[],
  databaseId: string,
  state: SyncTaskState
): Promise<SyncTaskState> {
  const token = deps.token ?? '';
  if (state.phase === 'verify') {
    const target = await deps.api.verifyDatabaseAccess(databaseId, token);
    return { ...state, dataSourceId: target.dataSourceId, phase: 'scan' };
  }
  const dataSourceId = state.dataSourceId!;
  if (state.phase === 'scan') {
    if (state.scannedPages >= 1000) throw new Error('NOTION_SCAN_LIMIT');
    const page = await deps.api.existingLinksPage(dataSourceId, token, state.cursor);
    await deps.assertCurrent();
    for (const pageId of page.describedPageIds) await deps.protectDescription(pageId);
    return {
      ...state,
      scannedPages: state.scannedPages + 1,
      records: [...state.records, ...page.records],
      cursor: page.cursor,
      phase: page.cursor ? 'scan' : 'plan',
    };
  }
  if (state.phase === 'plan')
    return { ...state, work: planWork(links, state.records), phase: 'prepare' };
  if (state.phase === 'prepare') {
    if (state.index >= state.work.length) return { ...state, phase: 'done' };
    const writeNonce = crypto.randomUUID();
    permits.add(writeNonce);
    return { ...state, writeNonce, pageId: undefined, phase: 'write' };
  }
  if (state.phase === 'write') return writeItem(deps, permits, databaseId, state);
  if (state.phase === 'describe') {
    let descriptionFailures = state.descriptionFailures;
    try {
      if (state.pageId && (!deps.canDescribe || (await deps.canDescribe(state.pageId)))) {
        const item = await deps.enrich(state.work[state.index].item);
        await deps.assertCurrent();
        if (item.description?.trim()) await deps.fillDescription(state.pageId, item.description);
      }
    } catch {
      // 可选 AI 或描述写入失败不能阻止基本书签同步；连接失效仍须停止。
      await deps.assertCurrent();
      descriptionFailures++;
    }
    return {
      ...state,
      phase: 'prepare',
      index: state.index + 1,
      completed: state.completed + 1,
      descriptionFailures,
    };
  }
  return state;
}

function planWork(links: LinkItem[], records: ExistingLinkRecord[]): SyncWork[] {
  return links.map((item) => {
    const existing = records.find(
      (row) =>
        (item.syncId && row.syncId === item.syncId) ||
        (row.url === item.url && (row.type ?? 'bookmark') === (item.type ?? 'bookmark'))
    );
    const plan = diffLinkItems([item], existing ? [existing] : []);
    if (existing && !existing.pageId) throw new Error('NOTION_PAGE_ID_MISSING');
    return { item, pageId: existing?.pageId, update: Boolean(plan.toUpdate?.length) };
  });
}

async function writeItem(
  deps: SyncStepDependencies,
  permits: Set<string>,
  databaseId: string,
  state: SyncTaskState
): Promise<SyncTaskState> {
  const { item, pageId, update } = state.work[state.index];
  const token = deps.token ?? '';
  let target = pageId;
  let matchedByUrl = false;
  if (pageId && update) {
    const properties = await deps.api.buildPropertiesFromDataSource(
      state.dataSourceId!,
      token,
      item,
      { omitDescription: true }
    );
    await deps.assertCurrent();
    await deps.api.updatePage(pageId, properties, token);
  } else if (!pageId) {
    if (!item.syncId) throw new Error('NOTION_SYNC_ID_REQUIRED');
    target = await deps.api.findPageBySyncId(state.dataSourceId!, token, item.syncId);
    if (!target) {
      await deps.assertCurrent();
      target = await deps.api.findPageByUrlAndType(state.dataSourceId!, token, item.url, item.type);
      matchedByUrl = Boolean(target);
    }
    if (!target) {
      if (!state.writeNonce || !permits.delete(state.writeNonce))
        throw new Error('NOTION_WRITE_UNCERTAIN');
      const properties = await deps.api.buildPropertiesFromDataSource(
        state.dataSourceId!,
        token,
        item,
        { omitDescription: true }
      );
      await deps.assertCurrent();
      const created = await deps.api.createPage(
        { type: 'database_id', database_id: databaseId },
        properties,
        token
      );
      target =
        created &&
        typeof created === 'object' &&
        typeof (created as { id?: unknown }).id === 'string'
          ? (created as { id: string }).id
          : undefined;
      if (!target) throw new Error('NOTION_WRITE_UNCERTAIN');
    }
  }
  if (state.writeNonce) permits.delete(state.writeNonce);
  return {
    ...state,
    phase: 'describe',
    pageId: target,
    created: state.created + (pageId || matchedByUrl ? 0 : 1),
    updated: state.updated + (update ? 1 : 0),
  };
}
