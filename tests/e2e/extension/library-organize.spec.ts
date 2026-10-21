import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test';
import path from 'node:path';

const extensionBuildDirectory = process.env.BOOKMARK_ASSISTANT_EXTENSION_BUILD || 'dist';
const extensionPath = path.resolve(
  __dirname,
  `../../../packages/extension/${extensionBuildDirectory}`
);

// Headless Chrome cannot answer the optional-permission prompt, so the test grants
// it by replacing chrome.permissions in the running extension contexts only.
const grantPermissions = () => {
  Object.defineProperty(chrome, 'permissions', {
    configurable: true,
    value: {
      request: async () => true,
      contains: async () => true,
      remove: async () => true,
    },
  });
};

test.describe('AI library organization', () => {
  let context: BrowserContext;
  let worker: Worker;
  let extensionId: string;
  let providerRequests: string[];

  test.beforeAll(async () => {
    test.skip(
      process.env.BOOKMARK_ASSISTANT_RELEASE_CHROME === '1',
      'Organize E2E runs headless only.'
    );
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-crash-reporter',
        '--disable-crashpad',
      ],
    });
    worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    extensionId = new URL(worker.url()).host;
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('previews, corrects, applies and undoes AI folder suggestions', async () => {
    providerRequests = [];
    const ids = await worker.evaluate(async () => {
      const design = await chrome.bookmarks.create({ parentId: '1', title: 'Design' });
      const reading = await chrome.bookmarks.create({ parentId: '1', title: 'Reading' });
      const figma = await chrome.bookmarks.create({
        parentId: '1',
        title: 'Figma tips',
        url: 'https://figma.example/blog?session=secret',
      });
      const essay = await chrome.bookmarks.create({
        parentId: '1',
        title: 'Long essay',
        url: 'https://essay.example/post',
      });
      return { design: design.id, reading: reading.id, figma: figma.id, essay: essay.id };
    });
    await worker.evaluate(grantPermissions);

    await context.route('https://api.openai.com/**', async (route) => {
      const body = route.request().postDataJSON() as { input: string; max_output_tokens: number };
      providerRequests.push(route.request().postData() ?? '');
      if (body.max_output_tokens === 16) {
        await route.fulfill({ status: 200, json: { id: 'validation' } });
        return;
      }
      const payload = JSON.parse(body.input.split('\n').at(-1)!) as {
        folders: Array<{ id: string; path: string }>;
        bookmarks: Array<{ id: string; title: string }>;
      };
      const alias = (title: string) => payload.bookmarks.find((item) => item.title === title)!.id;
      const folder = (name: string) => payload.folders.find((item) => item.path.endsWith(name))!.id;
      const text = JSON.stringify({
        moves: [
          { item: alias('Figma tips'), folder: folder('Design'), reason: 'Design tooling' },
          { item: alias('Long essay'), folder: folder('Design'), reason: 'Unsure' },
        ],
      });
      await route.fulfill({
        status: 200,
        json: { id: 'plan', output: [{ content: [{ type: 'output_text', text }] }] },
      });
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html#/library`);
    await page.evaluate(grantPermissions);
    const message = (key: string, substitutions?: string[]) =>
      page.evaluate(([k, s]) => chrome.i18n.getMessage(k as string, s as string[]), [
        key,
        substitutions,
      ] as const);

    await page.getByRole('button', { name: await message('organize_open') }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type="password"]').fill('sk-e2e-1234');
    await dialog.getByRole('button', { name: await message('organize_key_save') }).click();
    await expect(dialog).toContainText('1234');

    await dialog.getByRole('button', { name: await message('organize_start') }).click();
    await expect(dialog.getByText('Figma tips')).toBeVisible();
    expect(providerRequests.join('\n')).not.toContain('session=secret');

    await dialog
      .getByRole('checkbox', { name: await message('organize_select_bookmark', ['Long essay']) })
      .uncheck();
    await dialog.getByRole('button', { name: await message('organize_apply', ['1']) }).click();
    await expect(dialog).toContainText(await message('organize_apply_result', ['1', '0']));

    const parentOf = (id: string) =>
      worker.evaluate(
        async (bookmarkId) => (await chrome.bookmarks.get(bookmarkId))[0].parentId,
        id
      );
    expect(await parentOf(ids.figma)).toBe(ids.design);
    expect(await parentOf(ids.essay)).toBe('1');

    await dialog.getByRole('button', { name: await message('organize_undo') }).click();
    await expect(dialog).toContainText(await message('organize_undo_result', ['1', '0']));
    expect(await parentOf(ids.figma)).toBe('1');
  });
});
