import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESTINATION_REVISION_KEY,
  NOTION_DATABASE_KEY,
  NOTION_TOKEN_KEY,
  clearNotionConnection,
  commitNotionConnection,
  readDestinationContext,
  readNotionConnection,
  withCurrentDestination,
  isStaleDestinationStateError,
} from './destination-state';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  const pick = (keys: string | string[] | null) =>
    keys === null
      ? { ...store }
      : Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).filter((k) => k in store).map((k) => [k, store[k]])
        );
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | null) => pick(keys)),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(store, values)),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
        }),
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

const CONNECTION = {
  token: 'ntn_secret',
  database: { id: 'db-1', title: 'Bookmarks', workspaceName: 'Aries' },
};

describe('destination state', () => {
  it('saves a connection, bumps the revision and clears progress from the old database', async () => {
    store.last_sync_fingerprint = 'old';
    const empty = await readDestinationContext();
    const connected = await commitNotionConnection(empty, CONNECTION);

    expect(connected).toMatchObject({ token: 'ntn_secret', databaseId: 'db-1' });
    expect(connected.revision).toBeTruthy();
    expect(store[DESTINATION_REVISION_KEY]).toBe(connected.revision);
    expect(store.last_sync_fingerprint).toBeUndefined();
    await expect(readNotionConnection()).resolves.toEqual(CONNECTION);
  });

  it('drops a commit that started under an earlier connection', async () => {
    const empty = await readDestinationContext();
    await commitNotionConnection(empty, CONNECTION);

    const write = vi.fn(async () => undefined);
    await expect(withCurrentDestination(empty, write)).rejects.toSatisfy(
      isStaleDestinationStateError
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('disconnects locally and keeps the revision moving', async () => {
    const connected = await commitNotionConnection(await readDestinationContext(), CONNECTION);
    const cleared = await clearNotionConnection(connected);

    expect(store[NOTION_TOKEN_KEY]).toBeUndefined();
    expect(store[NOTION_DATABASE_KEY]).toBeUndefined();
    expect(cleared.revision).not.toBe(connected.revision);
    await expect(readNotionConnection()).resolves.toBeNull();
  });

  it('ignores a malformed stored database', async () => {
    store[NOTION_TOKEN_KEY] = 'ntn_secret';
    store[NOTION_DATABASE_KEY] = { title: 'no id' };
    await expect(readNotionConnection()).resolves.toBeNull();
    await expect(readDestinationContext()).resolves.toMatchObject({
      token: null,
      databaseId: null,
    });
  });
});
