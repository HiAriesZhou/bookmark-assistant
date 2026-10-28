import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from '@playwright/test';
import path from 'node:path';

const extensionBuildDirectory = process.env.BOOKMARK_ASSISTANT_EXTENSION_BUILD || 'dist';
const expectedProductName = 'Bookmark Assistant';
const extensionPath = path.resolve(
  __dirname,
  `../../../packages/extension/${extensionBuildDirectory}`
);
const releaseChrome = process.env.BOOKMARK_ASSISTANT_RELEASE_CHROME === '1';

if (releaseChrome && process.env.BOOKMARK_ASSISTANT_ALLOW_VISIBLE_BROWSER !== '1') {
  throw new Error(
    'Visible Chrome is release-only. Re-run only for an approved pre-release smoke test with BOOKMARK_ASSISTANT_ALLOW_VISIBLE_BROWSER=1.'
  );
}

async function launchExtensionContext(): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const context = await chromium.launchPersistentContext('', {
    channel: releaseChrome ? 'chrome' : 'chromium',
    headless: !releaseChrome,
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

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }

  const extensionId = new URL(serviceWorker.url()).host;
  return { context, extensionId };
}

async function openExtensionPage(
  context: BrowserContext,
  extensionId: string,
  pageName: 'popup.html' | 'options.html'
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${pageName}`);
  return page;
}

async function getLocalizedMessages<K extends string>(
  page: Page,
  keys: readonly K[]
): Promise<Record<K, string>> {
  return page.evaluate(
    (messageKeys) =>
      Object.fromEntries(messageKeys.map((key) => [key, chrome.i18n.getMessage(key)])) as Record<
        K,
        string
      >,
    keys
  );
}

// A synthetic token; the Notion API is answered by the fixture below and never reached.
const FIXTURE_TOKEN = 'ntn_e2e_fixture_token';
const NOTION_API_PATTERN = 'https://api.notion.com/v1/**';
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
};
const FIXTURE_PROPERTIES = {
  Name: { id: 'title', type: 'title', title: {} },
  URL: { id: 'url', type: 'url', url: {} },
  Tags: { id: 'tags', type: 'multi_select', multi_select: { options: [] } },
  Description: { id: 'desc', type: 'rich_text', rich_text: {} },
  Folder: { id: 'folder', type: 'rich_text', rich_text: {} },
  'Date Added': { id: 'date', type: 'date', date: {} },
  'Sync ID': { id: 'sync', type: 'rich_text', rich_text: {} },
};

/**
 * Answers the Notion endpoints the extension uses with one database and an empty data
 * source. With `holdPageCreates`, that many page creates wait until released.
 */
async function routeNotionFixture(
  context: BrowserContext,
  { holdPageCreates = 0 }: { holdPageCreates?: number } = {}
) {
  const created: string[] = [];
  const authorizations = new Set<string>();
  let release!: () => void;
  let held!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const pageCreatesHeld = new Promise<void>((resolve) => (held = resolve));
  if (holdPageCreates === 0) release();

  const json = (route: Route, body: unknown) =>
    route.fulfill({
      status: 200,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

  await context.route(NOTION_API_PATTERN, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS_HEADERS });
    }
    const auth = await request.headerValue('authorization');
    if (auth) authorizations.add(auth);
    const path = new URL(request.url()).pathname.replace('/v1/', '');
    const body = request.postDataJSON?.() ?? null;
    if (path === 'users/me') {
      return json(route, { object: 'user', type: 'bot', bot: { workspace_name: 'Fixture' } });
    }
    if (path === 'search') {
      const results =
        body?.filter?.value === 'data_source'
          ? [
              {
                object: 'data_source',
                id: 'ds-fixture',
                title: [{ plain_text: 'Fixture Reading' }],
                parent: { type: 'database_id', database_id: 'db-fixture' },
              },
            ]
          : [];
      return json(route, { object: 'list', results, has_more: false, next_cursor: null });
    }
    if (path === 'databases/db-fixture') {
      return json(route, {
        object: 'database',
        id: 'db-fixture',
        title: [{ plain_text: 'Fixture Reading' }],
        data_sources: [{ id: 'ds-fixture', name: 'Fixture Reading' }],
      });
    }
    if (path === 'data_sources/ds-fixture') {
      return json(route, {
        object: 'data_source',
        id: 'ds-fixture',
        properties: FIXTURE_PROPERTIES,
      });
    }
    if (path === 'data_sources/ds-fixture/query') {
      return json(route, { object: 'list', results: [], has_more: false, next_cursor: null });
    }
    if (path === 'pages' && request.method() === 'POST') {
      created.push(body?.properties?.URL?.url);
      if (created.length === holdPageCreates) held();
      await released;
      return json(route, { object: 'page', id: `page-${created.length}`, properties: {} });
    }
    return route.fulfill({
      status: 404,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: JSON.stringify({ object: 'error', status: 404, code: 'object_not_found' }),
    });
  });

  return {
    pageCreatesHeld,
    releasePageCreates: () => release(),
    createdUrls: () => [...created],
    authorizations: () => [...authorizations],
    dispose: () => context.unroute(NOTION_API_PATTERN),
  };
}

test.describe('Bookmark Assistant extension', () => {
  let context: BrowserContext;
  let extensionId: string;

  test.beforeAll(async () => {
    const launched = await launchExtensionContext();
    context = launched.context;
    extensionId = launched.extensionId;
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('loads the MV3 extension service worker and manifest', async () => {
    expect(extensionId).toMatch(/^[a-p]{32}$/);

    const page = await openExtensionPage(context, extensionId, 'popup.html');
    const manifest = await page.evaluate(() => chrome.runtime.getManifest());

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toContain(expectedProductName);
    expect(manifest.background?.service_worker).toBe('assets/background.js');
    expect(manifest.permissions).toContain('favicon');
    expect(manifest.permissions).not.toContain('identity');
    // A new host permission would show a warning and disable existing installs on update;
    // the API is reached through CORS instead.
    expect(manifest.host_permissions ?? []).toEqual([]);
    // Toolbar icons must resolve to real images at their declared pixel sizes.
    const iconSizes = await page.evaluate(async () => {
      const icons = chrome.runtime.getManifest().action?.default_icon as Record<string, string>;
      return Promise.all(
        [16, 32, 48].map(async (size) => {
          const image = new Image();
          image.src = chrome.runtime.getURL(icons[String(size)]);
          await image.decode();
          return [size, image.naturalWidth, image.naturalHeight];
        })
      );
    });
    expect(iconSizes).toEqual([
      [16, 16, 16],
      [32, 32, 32],
      [48, 48, 48],
    ]);
  });

  test('renders the disconnected popup state', async () => {
    const page = await openExtensionPage(context, extensionId, 'options.html');
    await page.evaluate(() => chrome.storage.local.clear());
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    const labels = await getLocalizedMessages(page, [
      'popup_library',
      'syncNow',
      'saveCurrentPage',
    ] as const);
    const bookmarkCountLabel = await page.evaluate(() =>
      chrome.i18n.getMessage('popup_bookmark_count', '0')
    );

    await expect(page.getByRole('heading', { name: expectedProductName })).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(labels.popup_library) })
    ).toBeVisible();
    await expect(page.getByText(bookmarkCountLabel)).toBeVisible();
    await expect(page.getByRole('button', { name: labels.syncNow })).toHaveCount(0);
    await expect(page.getByRole('button', { name: labels.saveCurrentPage })).toHaveCount(0);
    await expect(page.getByText('Notion')).toHaveCount(0);
  });

  test('opens the options page shell', async () => {
    const page = await openExtensionPage(context, extensionId, 'options.html');
    const labels = await getLocalizedMessages(page, [
      'nav_destinations',
      'nav_settings',
      'primary_navigation',
      'library_all',
    ] as const);

    await expect(page.getByText(expectedProductName, { exact: true }).first()).toBeVisible();
    const allBookmarksButton = page.getByRole('button', {
      name: new RegExp(labels.library_all),
    });
    await expect(allBookmarksButton).toBeVisible();
    await expect(page.getByRole('heading', { name: labels.library_all })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollHeight <= window.innerHeight &&
          document.body.scrollHeight <= window.innerHeight
      )
    ).toBe(true);
    await page.getByRole('button', { name: labels.nav_destinations, exact: true }).click();
    await expect(page.getByRole('heading', { name: labels.nav_destinations })).toBeVisible();
    await page
      .getByRole('navigation', { name: labels.primary_navigation })
      .getByRole('button', { name: labels.nav_settings })
      .click();
    await expect(page.locator('footer').getByText('GPL-3.0-only')).toBeVisible();
    await allBookmarksButton.click();
    await expect(page.getByRole('heading', { name: labels.library_all })).toBeVisible();
    await page.goto(`chrome-extension://${extensionId}/options.html#/organize`);
    await expect(page.getByRole('heading', { name: labels.library_all })).toBeVisible();
  });

  test('keeps the default local library free of remote requests', async () => {
    const page = await context.newPage();
    const remoteRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith('http')) remoteRequests.push(request.url());
    });

    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForTimeout(150);
    expect(remoteRequests).toEqual([]);
  });

  test('saves description and tags as local bookmark metadata', async () => {
    const page = await openExtensionPage(context, extensionId, 'popup.html');
    const storageKey = 'bookmark_library_metadata_v1';
    const title = `Local metadata ${Date.now()}`;
    await page.evaluate((key) => chrome.storage.local.remove(key), storageKey);
    const bookmarkId = await page.evaluate(
      ({ bookmarkTitle }) =>
        chrome.bookmarks
          .create({ title: bookmarkTitle, url: 'https://example.com/local-metadata' })
          .then((bookmark) => bookmark.id),
      { bookmarkTitle: title }
    );

    try {
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      const labels = await getLocalizedMessages(page, [
        'library_search_placeholder',
        'library_field_description',
        'library_add_tag',
        'library_save_changes',
        'library_saved_locally',
        'library_field_title',
        'library_all',
        'nav_destinations',
      ] as const);

      await page.getByPlaceholder(labels.library_search_placeholder).fill(title);
      await page.getByRole('button', { name: new RegExp(title) }).click();
      await page.getByLabel(labels.library_field_description).fill('Stored only on this device');
      await page.getByPlaceholder(labels.library_add_tag).fill('Reference');
      await page.getByRole('button', { name: labels.library_save_changes }).click();
      await expect(page.getByRole('status')).toContainText(labels.library_saved_locally);
      await expect(
        page.getByRole('button', { name: new RegExp(title) }).locator('..')
      ).toContainText('Reference');

      const metadata = await page.evaluate(
        ({ key, id }) =>
          chrome.storage.local
            .get(key)
            .then((result) => result[key]?.byBookmarkId?.[id] as unknown),
        { key: storageKey, id: bookmarkId }
      );
      expect(metadata).toMatchObject({
        description: 'Stored only on this device',
        tags: ['Reference'],
      });

      // A second visible window can change metadata without Chrome bookmark events.
      const otherPage = await openExtensionPage(context, extensionId, 'options.html');
      try {
        await otherPage.evaluate(
          async ({ key, id }) => {
            const stored = await chrome.storage.local.get(key);
            stored[key].byBookmarkId[id].description = 'Updated in another window';
            stored[key].byBookmarkId[id].tags = ['Elsewhere'];
            await chrome.storage.local.set(stored);
          },
          { key: storageKey, id: bookmarkId }
        );
        await expect(page.getByLabel(labels.library_field_description)).toHaveValue(
          'Updated in another window'
        );
        await page.getByLabel(labels.library_field_title).fill(`${title} renamed`);
        await page.getByRole('button', { name: labels.library_save_changes }).click();
        await expect(page.getByRole('status')).toContainText(labels.library_saved_locally);
        const saved = await page.evaluate(
          async ({ key, id }) => (await chrome.storage.local.get(key))[key].byBookmarkId[id],
          { key: storageKey, id: bookmarkId }
        );
        expect(saved).toMatchObject({
          description: 'Updated in another window',
          tags: ['Elsewhere'],
        });
      } finally {
        await otherPage.close();
      }

      await page.getByRole('button', { name: labels.nav_destinations, exact: true }).click();
      await page.getByRole('button', { name: new RegExp(labels.library_all) }).click();
      await page.getByLabel(labels.library_field_description).fill('Unsaved history draft');
      const backDialog = page.waitForEvent('dialog');
      await page.evaluate(() => window.history.back());
      await (await backDialog).dismiss();
      await expect(page.getByLabel(labels.library_field_description)).toHaveValue(
        'Unsaved history draft'
      );
      await expect(page).toHaveURL(/#\/library$/);
      // Allow a normal route change, then exercise Forward with another dirty draft.
      page.once('dialog', (dialog) => dialog.accept());
      await page.evaluate(() => (window.location.hash = '#/destinations'));
      await expect(page).toHaveURL(/#\/destinations$/);
      await page.evaluate(() => window.history.back());
      await expect(page.getByLabel(labels.library_field_description)).toHaveValue(
        'Updated in another window'
      );
      await page.getByLabel(labels.library_field_description).fill('Unsaved forward draft');
      const forwardDialog = page.waitForEvent('dialog');
      await page.evaluate(() => window.history.forward());
      await (await forwardDialog).accept();
      await expect(page).toHaveURL(/#\/destinations$/);
    } finally {
      await page.evaluate(
        async ({ key, id }) => {
          try {
            await chrome.bookmarks.remove(id);
          } catch {
            // The test may have already removed the temporary bookmark.
          }
          await chrome.storage.local.remove(key);
        },
        { key: storageKey, id: bookmarkId }
      );
    }
  });

  test('edits, moves, finds as a duplicate, and deletes a Chrome bookmark', async () => {
    const page = await openExtensionPage(context, extensionId, 'popup.html');
    const suffix = Date.now();
    const originalTitle = `Managed bookmark ${suffix}`;
    const updatedTitle = `${originalTitle} updated`;
    const duplicateTitle = `Duplicate bookmark ${suffix}`;
    const folderTitle = `Managed folder ${suffix}`;
    const updatedUrl = `https://example.com/managed-library?b=2&a=1#focus`;
    const created = await page.evaluate(
      async ({ bookmarkTitle, copyTitle, targetFolderTitle }) => {
        const tree = await chrome.bookmarks.getTree();
        const rootContainer = tree[0]?.children?.find((node) => !node.url);
        if (!rootContainer) throw new Error('No writable root bookmark folder');
        const folder = await chrome.bookmarks.create({
          parentId: rootContainer.id,
          title: targetFolderTitle,
        });
        const bookmark = await chrome.bookmarks.create({
          parentId: rootContainer.id,
          title: bookmarkTitle,
          url: 'https://example.com/managed-library-original',
        });
        const duplicate = await chrome.bookmarks.create({
          parentId: rootContainer.id,
          title: copyTitle,
          url: 'https://example.com/managed-library?a=1&b=2',
        });
        return { bookmarkId: bookmark.id, duplicateId: duplicate.id, folderId: folder.id };
      },
      { bookmarkTitle: originalTitle, copyTitle: duplicateTitle, targetFolderTitle: folderTitle }
    );

    try {
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      const labels = await getLocalizedMessages(page, [
        'library_search_placeholder',
        'library_field_title',
        'library_field_url',
        'library_field_folder',
        'library_save_changes',
        'library_saved_locally',
        'library_delete_bookmark',
        'library_delete_quick_confirm',
        'library_filter',
        'library_duplicates',
        'library_duplicate_removed_kept',
        'library_refresh_duplicates',
        'library_report_uncategorized',
      ] as const);

      await page.getByPlaceholder(labels.library_search_placeholder).fill(originalTitle);
      await page.getByRole('button', { name: new RegExp(originalTitle) }).click();
      await expect(page.locator('img[src*="/_favicon/"]').first()).toBeVisible();
      await page.getByLabel(labels.library_field_title).fill(updatedTitle);
      await page.getByLabel(labels.library_field_url).fill(updatedUrl);
      await page.getByRole('button', { name: labels.library_field_folder, exact: true }).click();
      await page.getByRole('option', { name: folderTitle }).click();
      await page.getByRole('button', { name: labels.library_save_changes }).click();
      await expect(page.getByRole('status')).toContainText(labels.library_saved_locally);

      const updated = await page.evaluate(async (bookmarkId) => {
        const [bookmark] = await chrome.bookmarks.get(bookmarkId);
        return { title: bookmark.title, url: bookmark.url, parentId: bookmark.parentId };
      }, created.bookmarkId);
      expect(updated).toEqual({
        title: updatedTitle,
        url: updatedUrl,
        parentId: created.folderId,
      });

      await page.getByPlaceholder(labels.library_search_placeholder).fill('');
      await page.getByRole('button', { name: labels.library_filter }).click();
      await page.getByRole('option', { name: labels.library_report_uncategorized }).click();
      await expect(page.getByRole('button', { name: new RegExp(duplicateTitle) })).toBeVisible();
      await expect(page.getByRole('button', { name: new RegExp(updatedTitle) })).toHaveCount(0);

      await page.getByRole('button', { name: labels.library_filter }).click();
      await page.getByRole('option', { name: labels.library_duplicates }).click();
      await expect(page.getByRole('button', { name: new RegExp(updatedTitle) })).toBeVisible();
      await expect(page.getByRole('button', { name: new RegExp(duplicateTitle) })).toBeVisible();

      const updatedRow = page.getByRole('button', { name: new RegExp(updatedTitle) }).locator('..');
      await updatedRow.hover();
      const rowDelete = updatedRow.getByRole('button', {
        name: labels.library_delete_bookmark,
        exact: true,
      });
      await rowDelete.click();
      const quickConfirm = page.getByRole('dialog', {
        name: labels.library_delete_quick_confirm,
      });
      await expect(quickConfirm).toBeVisible();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      const [deleteButtonBox, confirmBox] = await Promise.all([
        rowDelete.boundingBox(),
        quickConfirm.boundingBox(),
      ]);
      expect(deleteButtonBox).not.toBeNull();
      expect(confirmBox).not.toBeNull();
      expect(confirmBox!.y + confirmBox!.height).toBeLessThanOrEqual(deleteButtonBox!.y);
      await quickConfirm
        .getByRole('button', { name: labels.library_delete_bookmark, exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(async (bookmarkId) => {
            try {
              return (await chrome.bookmarks.get(bookmarkId)).length;
            } catch {
              return 0;
            }
          }, created.bookmarkId)
        )
        .toBe(0);
      await expect
        .poll(() =>
          page.evaluate(async (bookmarkId) => {
            try {
              return (await chrome.bookmarks.get(bookmarkId)).length;
            } catch {
              return 0;
            }
          }, created.duplicateId)
        )
        .toBe(1);
      await expect(page.getByRole('button', { name: labels.library_filter })).toContainText(
        labels.library_duplicates
      );
      await expect(page.getByRole('button', { name: new RegExp(duplicateTitle) })).toBeVisible();
      await expect(
        page.getByText(labels.library_duplicate_removed_kept, { exact: true })
      ).toBeVisible();
      await page.getByRole('button', { name: labels.library_refresh_duplicates }).click();
      await expect(page.getByRole('button', { name: new RegExp(duplicateTitle) })).toHaveCount(0);
    } finally {
      await page.evaluate(async ({ bookmarkId, duplicateId, folderId }) => {
        for (const id of [bookmarkId, duplicateId]) {
          try {
            await chrome.bookmarks.remove(id);
          } catch {
            // A completed test already removed the primary bookmark.
          }
        }
        try {
          await chrome.bookmarks.removeTree(folderId);
        } catch {
          // The temporary folder may already have been removed.
        }
      }, created);
    }
  });

  test('connects Notion with a token and syncs bookmarks to api.notion.com', async () => {
    const notion = await routeNotionFixture(context);
    const page = await openExtensionPage(context, extensionId, 'options.html');
    let bookmarkId: string | undefined;
    try {
      bookmarkId = await page.evaluate(async () => {
        await chrome.storage.local.clear();
        return (
          await chrome.bookmarks.create({
            title: 'Synthetic Notion sync item',
            url: 'https://example.invalid/notion-sync',
          })
        ).id;
      });
      await page.goto(`chrome-extension://${extensionId}/options.html#/destinations`);
      const labels = await getLocalizedMessages(page, [
        'notion_token_continue',
        'notion_connect_action',
      ] as const);
      await page.locator('[data-notion-token-input]').fill(FIXTURE_TOKEN);
      await page.getByRole('button', { name: labels.notion_token_continue }).click();
      await expect(page.getByRole('radio', { name: 'Fixture Reading' })).toBeChecked();
      await page
        .locator('form')
        .getByRole('button', { name: labels.notion_connect_action })
        .click();
      await expect(page.locator('[data-notion-token-input]')).toHaveCount(0);

      const stored = await page.evaluate(() =>
        chrome.storage.local.get(['notion_token', 'notion_database', 'destination_revision'])
      );
      expect(stored.notion_token).toBe(FIXTURE_TOKEN);
      expect(stored.notion_database).toMatchObject({ id: 'db-fixture' });
      // The token never leaves local storage.
      expect(JSON.stringify(await page.evaluate(() => chrome.storage.sync.get()))).not.toContain(
        FIXTURE_TOKEN
      );

      const reply = await page.evaluate(
        (destinationRevision) =>
          chrome.runtime.sendMessage({ type: 'SYNC_ALL_BOOKMARKS', destinationRevision }),
        stored.destination_revision
      );
      expect(reply.success).toBe(true);
      expect(notion.createdUrls()).toEqual(['https://example.invalid/notion-sync']);
      expect(notion.authorizations()).toEqual([`Bearer ${FIXTURE_TOKEN}`]);
    } finally {
      await notion.dispose();
      if (bookmarkId) await page.evaluate((id) => chrome.bookmarks.remove(id), bookmarkId);
      await page.close();
    }
  });

  test('disconnecting during a sync stops further Notion writes and drops the result', async () => {
    const notion = await routeNotionFixture(context, { holdPageCreates: 3 });
    const page = await openExtensionPage(context, extensionId, 'options.html');
    const revision = 'synthetic-disconnect-race';
    let bookmarkIds: string[] = [];
    try {
      bookmarkIds = await page.evaluate(
        async ({ revision, token }) => {
          await chrome.storage.local.clear();
          await chrome.storage.local.set({
            notion_token: token,
            notion_database: { id: 'db-fixture', title: 'Fixture Reading' },
            destination_revision: revision,
          });
          const created = [];
          for (const index of [1, 2, 3, 4]) {
            created.push(
              await chrome.bookmarks.create({
                title: `Synthetic disconnect item ${index}`,
                url: `https://example.invalid/disconnect-${index}`,
              })
            );
          }
          return created.map((bookmark) => bookmark.id);
        },
        { revision, token: FIXTURE_TOKEN }
      );
      const syncReply = page.evaluate(
        (destinationRevision) =>
          chrome.runtime.sendMessage({ type: 'SYNC_ALL_BOOKMARKS', destinationRevision }),
        revision
      );
      // The first write batch is in flight; disconnect before Notion answers it.
      await notion.pageCreatesHeld;
      const disconnected = await page.evaluate(
        (destinationRevision) =>
          chrome.runtime.sendMessage({ type: 'DISCONNECT_NOTION', destinationRevision }),
        revision
      );
      expect(disconnected.success).toBe(true);
      notion.releasePageCreates();

      expect((await syncReply).success).toBe(false);
      expect(notion.createdUrls()).toHaveLength(3);
      const stored = await page.evaluate(() =>
        chrome.storage.local.get([
          'notion_token',
          'notion_database',
          'last_sync',
          'last_sync_fingerprint',
          'sync_in_progress',
        ])
      );
      expect(stored.notion_token).toBeUndefined();
      expect(stored.notion_database).toBeUndefined();
      expect(stored.last_sync).toBeUndefined();
      expect(stored.last_sync_fingerprint).toBeUndefined();
      expect(stored.sync_in_progress).toBeUndefined();
    } finally {
      notion.releasePageCreates();
      await notion.dispose();
      await page.evaluate(
        (ids) => Promise.all(ids.map((id) => chrome.bookmarks.remove(id))),
        bookmarkIds
      );
      await page.close();
    }
  });

  test('background rejects save current page when disconnected', async () => {
    const page = await openExtensionPage(context, extensionId, 'popup.html');
    await page.evaluate(() => chrome.storage.local.clear());

    const response = await page.evaluate(
      () =>
        new Promise<{ success: boolean; error?: string }>((resolve) => {
          chrome.runtime.sendMessage({ type: 'SAVE_CURRENT_PAGE' }, resolve);
        })
    );

    expect(response).toEqual({ success: false, error: 'Not connected' });
  });
});
