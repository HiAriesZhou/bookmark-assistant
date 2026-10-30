// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { planOrganizeScope } from '../../core';
import { createTestRoot, cleanupTestRoot } from '../../testing/react-root';
import { useLibraryOrganize } from './useLibraryOrganize';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../utils/message', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/message')>()),
  sendMessage: send,
}));

afterEach(() => vi.unstubAllGlobals());

it('samples only eligible bookmark titles for the provider folder-mapping request', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const bookmarks = [
    { id: 'private', title: 'Private payroll', url: 'http://10.0.0.1/payroll' },
    { id: 'non-web', title: 'Browser settings', url: 'chrome://settings/' },
    {
      id: 'managed',
      title: 'Managed reference',
      url: 'https://example.com/managed',
      unmodifiable: true,
    },
    { id: 'public', title: 'Public reference', url: 'https://example.com/reference' },
  ].map((bookmark) => ({
    ...bookmark,
    parentId: '10',
    folderPath: 'Bar / Reference',
    isTopLevel: false,
  }));
  const folders = [
    { id: '1', parentId: '0', path: 'Bar' },
    { id: '10', parentId: '1', path: 'Bar / Reference' },
  ];
  const scope = planOrganizeScope(bookmarks, folders);
  expect(scope.excludedCount).toBe(3);
  expect(scope.items.map((item) => item.id)).toEqual(['public']);
  send
    .mockReset()
    .mockResolvedValueOnce({ success: true, key: { provider: 'deepseek', last4: 'test' } })
    .mockResolvedValueOnce({ success: false, errorCode: 'provider_request_failed' });
  let organize: ReturnType<typeof useLibraryOrganize>;
  function Harness() {
    organize = useLibraryOrganize(scope, 'en', { bookmarks, folders });
    return null;
  }
  const { root, container } = createTestRoot(false);
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => organize.start());
    const mapping = send.mock.calls.find(([message]) => message.type === 'ORGANIZE_MAP_FOLDERS');
    expect(mapping?.[0].request.folders).toEqual([
      {
        id: '10',
        path: 'Bar / Reference',
        bookmarkCount: 1,
        sampleTitles: ['Public reference'],
      },
    ]);
  } finally {
    await cleanupTestRoot(root, container);
  }
});
