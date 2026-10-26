import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';

const extensionBuildDirectory = process.env.BOOKMARK_ASSISTANT_EXTENSION_BUILD || 'dist';
const extensionPath = path.resolve(
  __dirname,
  `../../../packages/extension/${extensionBuildDirectory}`
);

function sessionToken(userId: string) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({
    userId,
    exp: Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60,
  })}.sig`;
}

async function launchExtensionContext(): Promise<{ context: BrowserContext; extensionId: string }> {
  const context = await chromium.launchPersistentContext('', {
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
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
  return { context, extensionId: new URL(serviceWorker.url()).host };
}

async function labels(page: Page) {
  return page.evaluate(
    (keys) =>
      Object.fromEntries(keys.map((key) => [key, chrome.i18n.getMessage(key)])) as Record<
        string,
        string
      >,
    [
      'nav_settings',
      'account_login',
      'account_email_label',
      'account_send_code',
      'account_code_label',
      'account_sign_in',
      'account_sign_out',
      'account_prior_notion_hint',
      'account_sign_in_google',
    ]
  );
}

test('signs in with an email code, shows the new-account hint, and signs out', async () => {
  const { context, extensionId } = await launchExtensionContext();
  try {
    await context.route('**/api/deployment', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          deploymentMode: 'hosted',
          commerceEnabled: false,
          capabilities: { autoSync: false, batchAi: false },
          signInMethods: ['email', 'notion'],
        }),
      })
    );
    await context.route('**/api/auth/email/start', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ email: 'person@example.com' });
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ accepted: true }),
      });
    });
    await context.route('**/api/auth/email/verify', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        email: 'person@example.com',
        code: '424242',
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          sessionToken: sessionToken('acct-e2e'),
          userId: 'acct-e2e',
          userEmail: 'person@example.com',
          accountCreated: true,
          hasNotionAccess: false,
        }),
      });
    });
    await context.route('**/api/user/profile', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          profile: {
            userId: 'acct-e2e',
            email: 'person@example.com',
            isPro: false,
            plan: 'free',
            deploymentMode: 'hosted',
            commerceEnabled: false,
            capabilities: { autoSync: false, batchAi: false },
            signInMethods: ['email', 'notion'],
            hasNotionAccess: false,
            hasGoogleSignIn: false,
            subscriptionSource: null,
            expiresAt: null,
          },
        }),
      })
    );

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html#/settings`);
    const text = await labels(page);
    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(text.account_login) })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'AI', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: text.account_sign_in_google })).toHaveCount(0);
    await page.getByLabel(text.account_email_label).fill('person@example.com');
    await page.getByRole('button', { name: text.account_send_code }).click();
    await page.getByLabel(text.account_code_label).fill('424242');
    await page.getByRole('button', { name: text.account_sign_in, exact: true }).click();
    // The same route switches in place from the login page to settings.
    await expect(page.getByRole('heading', { name: text.nav_settings, exact: true })).toBeVisible();
    await expect(
      page.locator('#account').getByText('person@example.com', { exact: true })
    ).toBeVisible();
    await expect(page.getByText(text.account_prior_notion_hint)).toBeVisible();
    await page.getByRole('button', { name: text.account_sign_out }).click();
    await expect(page.getByLabel(text.account_email_label)).toBeVisible();
    await expect(page.getByText(text.account_prior_notion_hint)).toHaveCount(0);
    const stored = await page.evaluate(() => chrome.storage.local.get('session_token'));
    expect(stored.session_token).toBeUndefined();
  } finally {
    await context.close();
  }
});
