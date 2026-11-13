export interface DescriptionHistoryEntry {
  status: 'reserved' | 'protected';
}

export interface DescriptionHistory {
  get(pageId: string): Promise<DescriptionHistoryEntry | undefined>;
  reserve(pageId: string): Promise<boolean>;
  protect(pageId: string): Promise<void>;
  /** 删除尚未发出写请求的预留；不影响受保护记录。 */
  release(pageId: string): Promise<void>;
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
  let current: Awaited<ReturnType<DescriptionWriter['readDescription']>>;
  try {
    current = await api.readDescription(pageId);
    await assertCurrent();
  } catch (error) {
    // 写请求尚未发出，释放预留以便重试；只有写入结果未知时才保留。
    // 释放失败时保留预留（只会少写，不会重写），并让原始错误决定任务重试。
    await history.release(pageId).catch(() => undefined);
    throw error;
  }
  // 用户在两次读取之间填写的描述保持预留，等同于受保护。
  if (current?.text.trim()) return 'skipped';
  if (!current || current.property !== before.property) {
    await history.release(pageId);
    return 'skipped';
  }
  // Notion 未提供条件写入；再次读取缩小并发修改窗口，但无法消除远端竞态。
  await api.writeDescription(pageId, current.property, text);
  return 'written';
}
