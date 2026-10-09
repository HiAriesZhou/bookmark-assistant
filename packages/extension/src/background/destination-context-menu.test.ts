import { beforeEach, expect, it, vi } from 'vitest';
import {
  SAVE_TO_NOTION_CONTEXT_MENU_ID,
  syncDestinationContextMenu,
} from './destination-context-menu';

const storage: Record<string, unknown> = {};
const create = vi.fn();
const remove = vi.fn((_id: string, callback: () => void) => callback());

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  create.mockClear();
  remove.mockClear();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
      },
    },
    contextMenus: { create, remove },
    runtime: { lastError: undefined },
    i18n: { getMessage: vi.fn(() => 'Save to Notion') },
  });
});

it('omits the destination action when no connection exists', async () => {
  await syncDestinationContextMenu();

  expect(remove).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
});

it('creates the destination action when a connection exists', async () => {
  storage.session_token = 'session-token';

  await syncDestinationContextMenu();

  expect(create).toHaveBeenCalledWith({
    id: SAVE_TO_NOTION_CONTEXT_MENU_ID,
    title: 'Save to Notion',
    contexts: ['page', 'link'],
  });
});

it('removes the destination action after disconnecting', async () => {
  storage.session_token = 'session-token';
  await syncDestinationContextMenu();
  storage.session_token = undefined;

  await syncDestinationContextMenu();

  expect(remove).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenCalledTimes(1);
});
