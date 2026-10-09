import { describe, expect, it, vi } from 'vitest';
import {
  consumePendingCurrentPageAi,
  createPendingCurrentPageAi,
  extractedPageMatchesPending,
  wasCurrentPageCreated,
} from './current-page-ai';

function createSessionStorage() {
  const values: Record<string, unknown> = {};
  return {
    values,
    storage: {
      get: vi.fn(async (key: string) => ({ [key]: values[key] })),
      set: vi.fn(async (next: Record<string, unknown>) => Object.assign(values, next)),
      remove: vi.fn(async (key: string) => {
        delete values[key];
      }),
    } as unknown as chrome.storage.StorageArea,
  };
}

describe('current page AI handoff', () => {
  const candidate = {
    tabId: 14,
    url: 'https://example.com/article?ref=bookmark',
    syncId: 'sync-created',
    knowledgeItemId: 'knowledge-created',
  };

  it("only starts AI for the current request's created Notion page", () => {
    expect(
      wasCurrentPageCreated(
        [{ success: true, bookmark: 'Article', action: 'created', syncId: 'sync-created' }],
        'sync-created'
      )
    ).toBe(true);
    expect(
      wasCurrentPageCreated(
        [{ success: true, bookmark: 'Article', action: 'updated', syncId: 'sync-created' }],
        'sync-created'
      )
    ).toBe(false);
    expect(
      wasCurrentPageCreated(
        [{ success: true, bookmark: 'Article', action: 'created', syncId: 'other-sync' }],
        'sync-created'
      )
    ).toBe(false);
  });

  it('stores only short-lived metadata in session storage and consumes it once', async () => {
    const { storage, values } = createSessionStorage();
    await createPendingCurrentPageAi(candidate, {
      requestId: 'request-1',
      expiresAt: 2_000,
      storage,
    });

    expect(values).toEqual({
      'pending_current_page_ai:request-1': { ...candidate, expiresAt: 2_000 },
    });
    await expect(consumePendingCurrentPageAi('request-1', 1_000, storage)).resolves.toEqual({
      ...candidate,
      expiresAt: 2_000,
    });
    await expect(consumePendingCurrentPageAi('request-1', 1_000, storage)).resolves.toBeUndefined();
  });

  it('refuses content extracted after the saved tab navigates elsewhere', () => {
    expect(
      extractedPageMatchesPending(candidate, {
        url: 'https://example.com/article?ref=bookmark',
      })
    ).toBe(true);
    expect(
      extractedPageMatchesPending(candidate, {
        url: 'https://example.com/another-page',
      })
    ).toBe(false);
  });
});
