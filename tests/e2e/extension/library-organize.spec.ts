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

  test('sorts by category, creates a missing category folder and undoes it', async () => {
    providerRequests = [];
    const ids = await worker.evaluate(async () => {
      const reading = await chrome.bookmarks.create({ parentId: '1', title: 'Read later' });
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
      return { reading: reading.id, figma: figma.id, essay: essay.id };
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
        folders?: Array<{ id: string; path: string }>;
        bookmarks?: Array<{ id: string; title: string }>;
      };
      const text = payload.folders
        ? // Step 1: the existing "Read later" folder already serves News & Reading.
          JSON.stringify({
            folders: payload.folders
              .filter((folder) => folder.path.endsWith('Read later'))
              .map((folder) => ({ folder: folder.id, category: 'reading' })),
          })
        : JSON.stringify({
            items: payload.bookmarks!.map((item) =>
              item.title === 'Figma tips'
                ? { item: item.id, reason: 'Design tool', category: 'tools', confidence: 'high' }
                : { item: item.id, reason: 'An essay', category: 'reading', confidence: 'low' }
            ),
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

    // The uncertain suggestion is shown but not selected.
    await expect(
      dialog.getByRole('checkbox', {
        name: await message('organize_select_bookmark', ['Long essay']),
      })
    ).not.toBeChecked();
    await dialog.getByRole('button', { name: await message('organize_apply', ['1']) }).click();
    await expect(dialog).toContainText(await message('organize_apply_result', ['1', '0']));

    const parentOf = (id: string) =>
      worker.evaluate(
        async (bookmarkId) => (await chrome.bookmarks.get(bookmarkId))[0].parentId,
        id
      );
    const toolsFolder = await worker.evaluate(async () =>
      (await chrome.bookmarks.getChildren('1')).find((node) => node.title === 'Tools & Apps')
    );
    expect(toolsFolder?.url).toBeUndefined();
    expect(await parentOf(ids.figma)).toBe(toolsFolder?.id);
    expect(await parentOf(ids.essay)).toBe('1');

    await dialog.getByRole('button', { name: await message('organize_undo') }).click();
    await expect(dialog).toContainText(await message('organize_undo_result', ['1', '0']));
    expect(await parentOf(ids.figma)).toBe('1');
    expect(
      await worker.evaluate(async () =>
        (await chrome.bookmarks.getChildren('1')).some((node) => node.title === 'Tools & Apps')
      )
    ).toBe(false);
  });
});
