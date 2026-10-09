/**
 * Chrome API Mock Utilities
 * Provides reusable mocks for Chrome extension APIs
 */
import { vi } from 'vitest';

export interface ChromeMockStorage {
  data: Record<string, any>;
}

export function createChromeMock(initialStorage: Record<string, any> = {}) {
  const storage: ChromeMockStorage = { data: { ...initialStorage } };

  // Load messages.json for i18n testing
  let messages: Record<string, { message: string }> = {};
  try {
    messages = require('../../packages/extension/_locales/en/messages.json');
  } catch {
    // Fallback: return key as translation
    console.warn('[chrome-mock] Could not load messages.json, using keys as fallback');
  }

  return {
    i18n: {
      getMessage: (key: string, _substitutions?: string | string[]) => {
        // Return translation if available, otherwise return key
        return messages[key]?.message || key;
      },
      getAcceptLanguages: vi.fn().mockResolvedValue(['en']),
      getUILanguage: () => 'en',
      detectLanguage: vi.fn().mockResolvedValue({
        languages: [{ language: 'en', percentage: 100 }],
      }),
    },
    alarms: {
      create: vi.fn(),
      clear: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      onAlarm: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    storage: {
      local: {
        get: vi.fn((keys) => {
          if (typeof keys === 'string') {
            return Promise.resolve({ [keys]: storage.data[keys] });
          }
          if (Array.isArray(keys)) {
            const result: Record<string, any> = {};
            keys.forEach((key) => {
              result[key] = storage.data[key];
            });
            return Promise.resolve(result);
          }
          return Promise.resolve(storage.data);
        }),
        set: vi.fn((items) => {
          Object.assign(storage.data, items);
          return Promise.resolve();
        }),
        remove: vi.fn((keys) => {
          const keysArray = Array.isArray(keys) ? keys : [keys];
          keysArray.forEach((key) => delete storage.data[key]);
          return Promise.resolve();
        }),
        clear: vi.fn(() => {
          storage.data = {};
          return Promise.resolve();
        }),
      },
    },
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({}),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      id: 'test-extension-id',
    },
    bookmarks: {
      getTree: vi.fn().mockResolvedValue([
        {
          id: '0',
          title: 'Bookmarks',
          children: [
            {
              id: '1',
              title: 'Bookmark Bar',
              children: [
                {
                  id: '2',
                  title: 'Example',
                  url: 'https://example.com',
                  dateAdded: Date.now(),
                },
              ],
            },
          ],
        },
      ]),
      create: vi.fn(),
      remove: vi.fn(),
      update: vi.fn(),
    },
    identity: {
      launchWebAuthFlow: vi.fn(),
    },
    action: {
      onClicked: {
        addListener: vi.fn(),
      },
    },
  };
}

export function setupChromeMock(initialStorage: Record<string, any> = {}) {
  const mock = createChromeMock(initialStorage);
  vi.stubGlobal('chrome', mock);
  return mock;
}
