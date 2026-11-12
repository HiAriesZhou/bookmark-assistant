export interface DescriptionHistoryEntry {
  status: 'reserved' | 'protected';
}

export interface DescriptionHistory {
  get(pageId: string): Promise<DescriptionHistoryEntry | undefined>;
  reserve(pageId: string): Promise<boolean>;
  protect(pageId: string): Promise<void>;
}

export interface DescriptionWriter {
  readDescription(pageId: string): Promise<{ property: string; text: string } | undefined>;
  writeDescription(pageId: string, property: string, text: string): Promise<void>;
}

/** 先持久记录写入意图；未知结果不自动重发，保护用户清空后的空值。 */
export async function fillMissingDescription(
  pageId: string,
  text: string,
  options: {
    api: DescriptionWriter;
    history: DescriptionHistory;
    assertCurrent: () => Promise<void>;
  }
): Promise<'written' | 'skipped'> {
  const { api, history, assertCurrent } = options;
  if (!text.trim()) return 'skipped';
  await assertCurrent();
  if (await history.get(pageId)) return 'skipped';
  const before = await api.readDescription(pageId);
  await assertCurrent();
  if (!before) return 'skipped';
  if (before.text.trim()) {
    await history.protect(pageId);
    return 'skipped';
  }
  if (!(await history.reserve(pageId))) return 'skipped';
  const current = await api.readDescription(pageId);
  await assertCurrent();
  if (!current || current.property !== before.property || current.text.trim()) return 'skipped';
  // Notion 未提供条件写入；再次读取缩小并发修改窗口，但无法消除远端竞态。
  await api.writeDescription(pageId, current.property, text);
  return 'written';
}
