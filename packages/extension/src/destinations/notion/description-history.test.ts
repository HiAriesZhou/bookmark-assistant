import { beforeEach, expect, it, vi } from 'vitest';
import { NOTION_DESCRIPTION_HISTORY_KEY, createDescriptionHistory } from './description-history';

const storage: Record<string, unknown> = {};
let current = { revision: 'r1', token: 'token', databaseId: 'db' };

vi.mock('../../utils/destination-state', () => ({
  mutateDestinationState: <T>(action: () => Promise<T>) => action(),
  withCurrentDestination: async <T>(
    context: typeof current,
    action: () => Promise<T>
  ): Promise<T> => {
    if (context.revision !== current.revision) throw new Error('stale');
    return action();
  },
}));

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  current = { revision: 'r1', token: 'token', databaseId: 'db' };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: storage[key] }),
        set: async (values: Record<string, unknown>) => Object.assign(storage, values),
      },
    },
  });
});

it('releases only unsent reservations, even after the connection changed', async () => {
  const history = createDescriptionHistory({ ...current });
  expect(await history.reserve('sent')).toBe(true);
  expect(await history.reserve('unsent')).toBe(true);
  await history.protect('user');

  current = { ...current, revision: 'r2' };
  await history.release('unsent');
  await history.release('user');

  expect(storage[NOTION_DESCRIPTION_HISTORY_KEY]).toEqual({
    'db/sent': { status: 'reserved' },
    'db/user': { status: 'protected' },
  });
});
