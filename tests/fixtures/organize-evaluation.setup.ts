import { vi } from 'vitest';

// Exercise the real evaluation entrypoint without reading a credential or contacting a provider.
vi.stubGlobal('fetch', () => {
  throw new Error('Network access is forbidden in the evaluation regression tests');
});

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const isKeyFile = (path: unknown) =>
    String(path).endsWith('/.config/bookmark-assistant/ai-test.key');
  return {
    ...fs,
    existsSync: (path: Parameters<typeof fs.existsSync>[0]) =>
      isKeyFile(path) ? process.env.BA_TEST_EVAL_SCENARIO !== 'missing-key' : fs.existsSync(path),
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
      if (!isKeyFile(args[0])) return fs.readFileSync(...args);
      if (process.env.BA_TEST_EVAL_SCENARIO === 'missing-key') {
        throw new Error('Missing synthetic evaluation credential');
      }
      return process.env.BA_TEST_EVAL_SCENARIO === 'empty-key' ? '  \n' : 'synthetic-test-value';
    },
  };
});

vi.mock('../../packages/extension/src/ai/providers', async () => {
  const { EVAL_BOOKMARKS, EVAL_EXPECTED_FOLDER_MAP, EVAL_FOLDERS } = await import(
    '../../packages/extension/eval/organize-fixture'
  );
  let folderCalls = 0;
  return {
    createAiProviderAdapter: () => ({
      generate: async (_key: string, prompt: string) => {
        const payload = JSON.parse(prompt.split('\n').at(-1)!);
        const scenario = process.env.BA_TEST_EVAL_SCENARIO;
        if (payload.folders) {
          folderCalls += 1;
          const folders = payload.folders.flatMap((folder: { id: string; path: string }) => {
            const fixtureId = EVAL_FOLDERS.find((entry) => entry.path === folder.path)!.id;
            let category = EVAL_EXPECTED_FOLDER_MAP[fixtureId];
            if (scenario === 'wrong-folder' && folderCalls === 2 && fixtureId === '12') {
              category = 'work';
            }
            if (scenario === 'unstable-folder' && fixtureId === '11') {
              category = folderCalls % 2 ? 'learning' : 'reading';
            }
            return category ? [{ folder: folder.id, category }] : [];
          });
          // Entry order is not a change in the folder mapping.
          if (folderCalls % 2 === 0) folders.reverse();
          return { text: JSON.stringify({ folders }) };
        }
        const items = payload.bookmarks.map((item: { id: string; title: string }) => {
          const bookmark = EVAL_BOOKMARKS.find((entry) => entry.title === item.title)!;
          const category = Array.isArray(bookmark.expected)
            ? (bookmark.expected[0] ?? 'unsorted')
            : bookmark.expected;
          return { item: item.id, category, confidence: 'high', reason: 'Synthetic evaluation' };
        });
        return { text: JSON.stringify({ items }) };
      },
    }),
  };
});
