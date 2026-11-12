import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
  type Worker,
} from '@playwright/test';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const extensionPath = path.resolve(__dirname, '../../../packages/extension/dist');
const DATABASE_ID = '1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9';
const DATA_SOURCE_ID = '2a3b4c5d-6e7f-4081-9293-a4b5c6d7e8f9';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
};
const PROPERTIES = {
  Name: { id: 'title', type: 'title', title: {} },
  URL: { id: 'url', type: 'url', url: {} },
  Description: { id: 'desc', type: 'rich_text', rich_text: {} },
  Folder: { id: 'folder', type: 'rich_text', rich_text: {} },
  'Sync ID': { id: 'sync', type: 'rich_text', rich_text: {} },
};
interface TaskSnapshot {
  id: string;
  type: string;
  status: string;
  version: number;
  attempts: number;
  errorCode?: string;
  state: { cursor?: number; completed?: number; proposals?: unknown[]; phase?: string };
}
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
// As in library-organize.spec.ts, fake only optional-permission prompts. Network is fully mocked.
function grantPermissions() {
  Object.defineProperty(chrome, 'permissions', {
    configurable: true,
    value: { request: async () => true, contains: async () => true, remove: async () => true },
  });
}
const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, headers: CORS, json: body });

/** Read-only observation of the real extension's database; never seeds or changes a task. */
async function tasks(worker: Worker): Promise<TaskSnapshot[]> {
  return worker.evaluate(async () => {
    if (!(await indexedDB.databases()).some((db) => db.name === 'bookmark-assistant-tasks-v1'))
      return [];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('bookmark-assistant-tasks-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<TaskSnapshot[]>((resolve, reject) => {
        const request = db.transaction('tasks', 'readonly').objectStore('tasks').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}
async function messages(page: Page, keys: string[]) {
  return page.evaluate(
    (keys) => Object.fromEntries(keys.map((key) => [key, chrome.i18n.getMessage(key)])),
    keys
  );
}
async function seedBookmarks(worker: Worker, count: number) {
  return worker.evaluate(async (count) => {
    for (const root of await chrome.bookmarks.getChildren('0')) {
      for (const child of await chrome.bookmarks.getChildren(root.id)) {
        if (child.url) await chrome.bookmarks.remove(child.id);
        else await chrome.bookmarks.removeTree(child.id);
      }
    }
    const ids: string[] = [];
    for (let index = 0; index < count; index++) {
      ids.push(
        (
          await chrome.bookmarks.create({
            parentId: '1',
            title: `Runtime reference ${index + 1}`,
            url: `https://runtime.example/reference/${index + 1}?private=fixture#part`,
          })
        ).id
      );
    }
    return ids;
  }, count);
}

async function providerFixture(context: BrowserContext, holdAssignment?: number) {
  const entered = latch();
  const released = latch();
  const assignments: string[][] = [];
  let folderCalls = 0;
  const handler = async (route: Route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: CORS });
    const body = route.request().postDataJSON();
    if (body.max_output_tokens === 16) return json(route, { id: 'synthetic-validation' });
    expect(body.input).not.toContain('private=fixture');
    expect(body.input).not.toContain('#part');
    const payload = JSON.parse(body.input.split('\n').at(-1));
    let text: string;
    if (Array.isArray(payload)) {
      text = JSON.stringify({
        descriptions: payload.map((item) => ({
          id: item.id,
          description: 'A reference inferred from its title and folder.',
        })),
      });
    } else if (payload.folders) {
      folderCalls++;
      text = '{"folders":[]}';
    } else {
      assignments.push(payload.bookmarks.map((item: { title: string }) => item.title));
      if (assignments.length === holdAssignment) {
        entered.release();
        await released.promise;
      }
      text = JSON.stringify({
        items: payload.bookmarks.map((item: { id: string }) => ({
          item: item.id,
          category: 'tools',
          confidence: 'high',
          reason: 'Reference tool',
        })),
      });
    }
    // Stopping a worker destroys its held request. That is expected fault injection.
    await json(route, {
      id: 'synthetic-generation',
      output: [{ content: [{ type: 'output_text', text }] }],
    }).catch((error) => {
      if (!/closed|disposed|Invalid InterceptionId|Target page|interception/i.test(String(error)))
        throw error;
    });
  };
  const install = (next: BrowserContext) => next.route('https://api.openai.com/**', handler);
  await install(context);
  return {
    install,
    entered: entered.promise,
    release: released.release,
    assignments,
    folderCalls: () => folderCalls,
  };
}

async function notionFixture(context: BrowserContext) {
  const entered = latch();
  const released = latch();
  const rows = new Map<string, Record<string, any>>();
  const writes: string[] = [];
  await context.route('https://api.notion.com/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: CORS });
    const endpoint = new URL(route.request().url()).pathname.replace('/v1/', '');
    const body = route.request().postDataJSON();
    if (endpoint === 'users/me')
      return json(route, {
        object: 'user',
        type: 'bot',
        bot: { workspace_name: 'Synthetic workspace' },
      });
    if (endpoint === `databases/${DATABASE_ID}`)
      return json(route, {
        object: 'database',
        id: DATABASE_ID,
        title: [{ plain_text: 'Runtime fixture' }],
        data_sources: [{ id: DATA_SOURCE_ID, name: 'Runtime fixture' }],
      });
    if (endpoint === `data_sources/${DATA_SOURCE_ID}`)
      return json(route, { object: 'data_source', id: DATA_SOURCE_ID, properties: PROPERTIES });
    if (endpoint === `data_sources/${DATA_SOURCE_ID}/query`)
      return json(route, {
        object: 'list',
        results: [...rows.values()],
        has_more: false,
        next_cursor: null,
      });
    if (endpoint === 'pages' && route.request().method() === 'POST') {
      const id = '3a3b4c5d-6e7f-4081-9293-a4b5c6d7e8f9';
      const row = {
        object: 'page',
        id,
        properties: { ...body.properties, Description: { type: 'rich_text', rich_text: [] } },
      };
      rows.set(id, row);
      entered.release();
      await released.promise;
      return json(route, row);
    }
    if (endpoint.startsWith('pages/')) {
      const row = rows.get(endpoint.slice('pages/'.length));
      if (row && route.request().method() === 'PATCH') {
        Object.assign(row.properties, body.properties);
        writes.push(JSON.stringify(body.properties));
      }
      if (row) return json(route, row);
    }
    throw new Error(`Unexpected mocked Notion endpoint: ${route.request().method()} ${endpoint}`);
  });
  return { entered: entered.promise, release: released.release, writes };
}

async function configureKey(page: Page) {
  await page.evaluate(grantPermissions);
  const labels = await messages(page, [
    'organize_open',
    'organize_key_save',
    'organize_close',
    'organize_start',
  ]);
  await page.getByRole('button', { name: labels.organize_open, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type="password"]').fill('synthetic-runtime-key-5678');
  await dialog.getByRole('button', { name: labels.organize_key_save, exact: true }).click();
  await expect(dialog).toContainText('5678');
  return { dialog, labels };
}

test.describe('production local task runtime', () => {
  let context: BrowserContext;
  let worker: Worker;
  let extensionId: string;
  let unexpectedNetwork: string[];
  let profile: string;
  async function launch() {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      viewport: { width: 1440, height: 1000 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-crash-reporter',
        '--disable-crashpad',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
      ],
    });
    await context.route(/^https?:/, async (route) => {
      unexpectedNetwork.push(route.request().url());
      await route.abort();
    });
    context.on('serviceworker', (replacement) => {
      void replacement.evaluate(grantPermissions).catch(() => undefined);
    });
  }
  test.beforeEach(async () => {
    test.skip(
      process.env.BOOKMARK_ASSISTANT_RELEASE_CHROME === '1',
      'This suite requires headless Chromium.'
    );
    test.setTimeout(90_000);
    profile = await mkdtemp(path.join(tmpdir(), 'bookmark-runtime-e2e-'));
    unexpectedNetwork = [];
    await launch();
    worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    extensionId = new URL(worker.url()).host;
    await worker.evaluate(grantPermissions);
  });
  test.afterEach(async () => {
    await context?.close();
    if (profile) await rm(profile, { recursive: true, force: true });
    expect(unexpectedNetwork).toEqual([]);
  });

  test('finishes Notion sync after Options closes and displays AI inference provenance', async ({}, testInfo) => {
    await seedBookmarks(worker, 1);
    await providerFixture(context);
    const notion = await notionFixture(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html#/library`);
    const { dialog, labels } = await configureKey(page);
    await dialog.getByRole('button', { name: labels.organize_close, exact: true }).first().click();
    const connection = await page.evaluate(
      async (databaseId) =>
        chrome.runtime.sendMessage({
          type: 'NOTION_CONNECT',
          token: 'synthetic-notion-token',
          databaseId,
          destinationRevision: null,
        }),
      DATABASE_ID
    );
    expect(connection.success).toBe(true);
    const submitted = await page.evaluate(
      async (revision) =>
        chrome.runtime.sendMessage({ type: 'SYNC_ALL_BOOKMARKS', destinationRevision: revision }),
      connection.destinationRevision
    );
    expect(submitted).toMatchObject({ success: true, queued: true });
    await notion.entered;
    await page.close();
    expect(context.pages().every((page) => !page.url().includes('/options.html'))).toBe(true);
    notion.release();
    await expect
      .poll(
        async () => (await tasks(worker)).find((task) => task.id === submitted.taskId)?.status,
        { timeout: 60_000 }
      )
      .toBe('succeeded');
    expect(notion.writes.join('\n')).toMatch(/AI inference:|AI 推断：/);
    const status = await worker.evaluate(async () =>
      chrome.storage.local.get(['sync_in_progress', 'last_sync_error', 'last_sync'])
    );
    expect(status).toMatchObject({ sync_in_progress: false, last_sync_error: null });
    expect(status.last_sync).toBeTruthy();
    const library = await context.newPage();
    await library.goto(`chrome-extension://${extensionId}/options.html#/library`);
    await library.getByText('Runtime reference 1', { exact: true }).first().click();
    const sourceLabel = (await messages(library, ['library_description_source_ai']))
      .library_description_source_ai;
    await expect(library.getByText(sourceLabel, { exact: true })).toBeVisible();
    await library.screenshot({
      path: testInfo.outputPath('ai-description-source.png'),
      fullPage: true,
    });
    await testInfo.attach('AI description provenance', {
      path: testInfo.outputPath('ai-description-source.png'),
      contentType: 'image/png',
    });
  });

  test('allows closing organize while running and restores its completed preview', async ({}, testInfo) => {
    await seedBookmarks(worker, 2);
    const provider = await providerFixture(context, 1);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html#/library`);
    const { dialog, labels } = await configureKey(page);
    await dialog.getByRole('button', { name: labels.organize_start, exact: true }).click();
    await provider.entered;
    await expect(
      dialog.getByRole('button', { name: labels.organize_close, exact: true }).first()
    ).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath('organize-running-closable.png'),
      fullPage: true,
    });
    await dialog.getByRole('button', { name: labels.organize_close, exact: true }).first().click();
    await expect(dialog).toBeHidden();
    await page.close();
    provider.release();
    await expect
      .poll(async () => (await tasks(worker)).find((task) => task.type === 'organize')?.status, {
        timeout: 60_000,
      })
      .toBe('succeeded');
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/options.html#/library`);
    await reopened.getByRole('button', { name: labels.organize_open, exact: true }).click();
    await expect(
      reopened.getByRole('dialog').getByText('Runtime reference 1', { exact: true })
    ).toBeVisible();
    await reopened.screenshot({
      path: testInfo.outputPath('organize-restored-preview.png'),
      fullPage: true,
    });
    await testInfo.attach('Organize can close while running', {
      path: testInfo.outputPath('organize-running-closable.png'),
      contentType: 'image/png',
    });
    await testInfo.attach('Restored organize preview', {
      path: testInfo.outputPath('organize-restored-preview.png'),
      contentType: 'image/png',
    });
  });

  test('resumes the IndexedDB checkpoint after a real browser and worker restart', async ({}) => {
    await seedBookmarks(worker, 21);
    const provider = await providerFixture(context, 2);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html#/library`);
    const { dialog, labels } = await configureKey(page);
    await dialog.getByRole('button', { name: labels.organize_start, exact: true }).click();
    await provider.entered;
    const before = (await tasks(worker)).find((task) => task.type === 'organize')!;
    expect(before.state).toMatchObject({ cursor: 1, completed: 2 });
    expect(before.state.proposals).toHaveLength(20);
    expect(before.status).toBe('running');
    await page.close();
    // Close the actual browser while the provider request is still pending. Only the
    // on-disk profile survives; the replacement worker must load the saved checkpoint.
    const stopped = worker.waitForEvent('close');
    await context.close();
    await stopped;
    provider.release();
    await launch();
    await provider.install(context);
    worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    expect(new URL(worker.url()).host).toBe(extensionId);
    await worker.evaluate(grantPermissions);
    let permissionRetried = false;
    let retryPage: Page | undefined;
    await expect
      .poll(
        async () => {
          const restored = (await tasks(worker)).find((task) => task.id === before.id);
          // Optional-host prompts are mocked in memory, so a new process can observe the
          // real (ungranted) permission before the fixture is restored. Retry ONLY that case
          // via the public message after restoring permission; never alter the task store.
          if (
            restored?.status === 'failed' &&
            restored.errorCode === 'permission_required' &&
            !permissionRetried
          ) {
            permissionRetried = true;
            expect(restored.state.cursor).toBe(1);
            retryPage = await context.newPage();
            await retryPage.goto(`chrome-extension://${extensionId}/popup.html`);
            const retried = await retryPage.evaluate(
              async (id) => chrome.runtime.sendMessage({ type: 'ORGANIZE_TASK_RETRY', id }),
              before.id
            );
            expect(retried.success).toBe(true);
            return 'pending';
          }
          if (restored?.status === 'failed')
            throw new Error(`Restarted task failed: ${restored.errorCode}`);
          return restored?.status;
        },
        { timeout: 60_000 }
      )
      .toBe('succeeded');
    await retryPage?.close();
    const after = (await tasks(worker)).find((task) => task.id === before.id)!;
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.state).toMatchObject({ cursor: 2, completed: 3 });
    expect(after.state.proposals).toHaveLength(21);
    expect(provider.folderCalls()).toBe(1);
    expect(provider.assignments).toHaveLength(3);
    expect(provider.assignments[0]).toHaveLength(20);
    expect(provider.assignments[1]).toHaveLength(1);
    expect(provider.assignments[2]).toEqual(provider.assignments[1]);
  });
});
