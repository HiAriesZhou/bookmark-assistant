import { withCurrentDestination, type DestinationContext } from '../../utils/destination-state';
import type { DescriptionHistory, DescriptionHistoryEntry } from './description-write';

export const NOTION_DESCRIPTION_HISTORY_KEY = ['notion', 'description', 'history', 'v1'].join('_');

type HistoryStore = Record<string, DescriptionHistoryEntry>;

async function readHistory(): Promise<HistoryStore> {
  const stored = (await chrome.storage.local.get(NOTION_DESCRIPTION_HISTORY_KEY))[
    NOTION_DESCRIPTION_HISTORY_KEY
  ];
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  return Object.fromEntries(
    Object.entries(stored).filter(([, value]) => {
      const entry = value as Partial<DescriptionHistoryEntry> | null;
      return entry?.status === 'reserved' || entry?.status === 'protected';
    })
  ) as HistoryStore;
}

/** 按数据库与页面保存；重新连接同一数据库也不能抹去用户的清空操作。 */
export function createDescriptionHistory(context: DestinationContext): DescriptionHistory {
  const key = (pageId: string) => `${context.databaseId}/${pageId}`;
  return {
    get: async (pageId) => (await readHistory())[key(pageId)],
    reserve: (pageId) =>
      withCurrentDestination(context, async () => {
        const all = await readHistory();
        if (all[key(pageId)]) return false;
        await chrome.storage.local.set({
          [NOTION_DESCRIPTION_HISTORY_KEY]: { ...all, [key(pageId)]: { status: 'reserved' } },
        });
        return true;
      }),
    protect: (pageId) =>
      withCurrentDestination(context, async () => {
        const all = await readHistory();
        if (all[key(pageId)]) return;
        await chrome.storage.local.set({
          [NOTION_DESCRIPTION_HISTORY_KEY]: { ...all, [key(pageId)]: { status: 'protected' } },
        });
      }),
  };
}
