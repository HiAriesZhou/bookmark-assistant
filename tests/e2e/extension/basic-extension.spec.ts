import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';

const OFFICIAL_API_ORIGIN = 'https://bookmark-assistant-server.vercel.app';
const extensionBuildDirectory = process.env.BOOKMARK_ASSISTANT_EXTENSION_BUILD || 'dist';
const expectedProductName = 'Bookmark Assistant';
const expectedApiOrigin = process.env.BOOKMARK_ASSISTANT_EXPECTED_API_ORIGIN || OFFICIAL_API_ORIGIN;
const officialService = expectedApiOrigin === OFFICIAL_API_ORIGIN;
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

test.describe('Bookmark Assistant Pro extension', () => {
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
    await page.getByRole('button', { name: labels.nav_settings, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: labels.nav_settings, exact: true })
    ).toBeVisible();
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

  test('uses the configured API origin', async () => {
    test.skip(
      !expectedApiOrigin,
      'API origin assertion is enabled for release and local E2E builds.'
    );

    const page = await openExtensionPage(context, extensionId, 'popup.html');
    if (!officialService) {
      const requests: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      await page.goto(`chrome-extension://${extensionId}/options.html#/settings`);
      await expect(page.getByText('GPL-3.0-only')).toBeVisible();
      const labels = await getLocalizedMessages(page, ['upgrade', 'view_plans'] as const);
      await expect(
        page.getByRole('button', { name: new RegExp(`^(${labels.upgrade}|${labels.view_plans})$`) })
      ).toHaveCount(0);
      expect(requests.filter((url) => url.includes('/api/pricing'))).toEqual([]);
      const profileRequest = context.waitForEvent('request', {
        predicate: (request) => request.url().endsWith('/api/user/profile'),
      });
      await context.route('**/api/user/profile', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            profile: {
              userId: 'fixture',
              isPro: true,
              plan: 'pro',
              deploymentMode: 'self-hosted',
              commerceEnabled: false,
              capabilities: { autoSync: true, batchAi: true },
              subscriptionSource: null,
              expiresAt: null,
            },
          }),
        })
      );
      const profileResult = await page.evaluate(async () => {
        await chrome.storage.local.set({ session_token: 'fixture-session' });
        return chrome.runtime.sendMessage({ type: 'GET_USER_PROFILE', forceRefresh: true });
      });
      expect(profileResult.success).toBe(true);
      const profileCache = await page.evaluate(() =>
        chrome.storage.local.get(['is_pro', 'deployment_profile'])
      );
      expect(profileCache.is_pro).toBe(true);
      expect(profileCache.deployment_profile).toMatchObject({
        deploymentMode: 'self-hosted',
        commerceEnabled: false,
        capabilities: { autoSync: true, batchAi: true },
      });
      expect(new URL((await profileRequest).url()).origin).toBe(expectedApiOrigin);
      await context.unroute('**/api/user/profile');
      // Later tests share this context. Log out through the background so its cached
      // profile and session are cleared too, then close the connected page.
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'LOGOUT' }));
      await page.close();
      return;
    }
    await page.evaluate(() => chrome.storage.local.remove('cached_pricing'));
    const pricingRequest = context.waitForEvent('request', {
      predicate: (request) => request.url().endsWith('/api/pricing'),
    });
    await page.goto(`chrome-extension://${extensionId}/options.html#/settings`);
    const labels = await getLocalizedMessages(page, ['upgrade', 'view_plans'] as const);
    // Settings has a single plan action; its label is localized and depends on the plan.
    await page
      .getByRole('button', { name: new RegExp(`^(${labels.upgrade}|${labels.view_plans})$`) })
      .click();

    expect(new URL((await pricingRequest).url()).origin).toBe(expectedApiOrigin);
  });

  test('account deletion discards pending profile and sync replies in the actual extension', async () => {
    const page = await openExtensionPage(context, extensionId, 'options.html');
    const gate = () => {
      let release!: () => void;
      let notify!: () => void;
      return {
        ready: new Promise<void>((resolve) => {
          notify = resolve;
        }),
        wait: new Promise<void>((resolve) => {
          release = resolve;
        }),
        release: () => release(),
        notify: () => notify(),
      };
    };
    const profileGate = gate(),
      syncGate = gate();
    const revision = 'synthetic-account-deletion-race';
    await context.route('**/api/user/profile', async (route) => {
      profileGate.notify();
      await profileGate.wait;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profile: {
            userId: 'synthetic-account',
            email: 'account@example.invalid',
            isPro: true,
            plan: 'pro',
            hasNotionAccess: true,
            hasNotionDatabase: true,
            deploymentMode: 'self-hosted',
            commerceEnabled: false,
            capabilities: { autoSync: true, batchAi: true },
            subscriptionSource: null,
            expiresAt: null,
          },
        }),
      });
    });
    await context.route('**/api/bookmarks/sync', async (route) => {
      syncGate.notify();
      await syncGate.wait;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ summary: { total: 1, success: 1, failed: 0 }, results: [] }),
      });
    });
    await context.route('**/api/user/account', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' })
    );
    let bookmarkId: string | undefined;
    try {
      bookmarkId = await page.evaluate(async (revision) => {
        await chrome.storage.local.clear();
        await chrome.storage.local.set({
          session_token: 'synthetic-session',
          user_id: 'synthetic-account',
          user_email: 'account@example.invalid',
          account_state_revision: revision,
          notion_connected: true,
        });
        return (
          await chrome.bookmarks.create({
            title: 'Synthetic account race item',
            url: 'https://example.invalid/account-race',
          })
        ).id;
      }, revision);
      await page.goto(`chrome-extension://${extensionId}/options.html#/settings`);
      await expect(page.locator('#service-data')).toBeVisible();
      const profileReply = page.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'GET_USER_PROFILE', forceRefresh: true })
      );
      const syncReply = page.evaluate(
        (accountRevision) =>
          chrome.runtime.sendMessage({ type: 'SYNC_ALL_BOOKMARKS', accountRevision }),
        revision
      );
      await Promise.all([profileGate.ready, syncGate.ready]);
      const labels = await getLocalizedMessages(page, ['service_data_delete_action'] as const);
      await page
        .locator('#service-data')
        .getByRole('button', { name: labels.service_data_delete_action })
        .click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: labels.service_data_delete_action })
        .click();
      await expect(page.locator('#service-data')).toHaveCount(0);
      const keys = [
        'session_token',
        'is_pro',
        'auto_sync_enabled',
        'last_sync_error',
        'dashboard_last_sync',
        'dashboard_recent_activity',
        'last_sync_fingerprint',
        'sync_enrichment_job',
      ];
      const cleared = await page.evaluate((keys) => chrome.storage.local.get(keys), keys);
      expect(cleared.session_token).toBeUndefined();
      const obsoleteSchedule = await page.evaluate(
        (accountRevision) =>
          chrome.runtime.sendMessage({
            type: 'SCHEDULE_AUTO_SYNC',
            enabled: true,
            intervalHours: 6,
            accountRevision,
          }),
        revision
      );
      expect(obsoleteSchedule.success).toBe(false);
      profileGate.release();
      syncGate.release();
      expect((await profileReply).success).toBe(false);
      expect((await syncReply).success).toBe(false);
      await expect(page.locator('#service-data')).toHaveCount(0);
      expect(await page.evaluate((keys) => chrome.storage.local.get(keys), keys)).toEqual(cleared);
    } finally {
      profileGate.release();
      syncGate.release();
      await context.unroute('**/api/user/profile');
      await context.unroute('**/api/bookmarks/sync');
      await context.unroute('**/api/user/account');
      if (bookmarkId) await page.evaluate((id) => chrome.bookmarks.remove(id), bookmarkId);
      await page.close();
    }
  });

  test('does not request protected AI data before connection', async () => {
    const page = await openExtensionPage(context, extensionId, 'popup.html');
    await page.evaluate(() => chrome.storage.local.clear());
    const protectedRequests: string[] = [];
    const protectedPaths = ['/api/ai/settings', '/api/ai/credential', '/api/ai/recent-processing'];
    const recordProtectedRequest = (request: { url(): string }) => {
      const requestUrl = request.url();
      if (protectedPaths.some((path) => requestUrl.includes(path))) {
        protectedRequests.push(requestUrl);
      }
    };
    context.on('request', recordProtectedRequest);

    await page.goto(`chrome-extension://${extensionId}/options.html#/settings`);
    await expect(page.getByRole('heading', { name: 'AI', exact: true })).toBeVisible();
    await page.waitForTimeout(100);
    context.off('request', recordProtectedRequest);

    expect(protectedRequests).toEqual([]);
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
