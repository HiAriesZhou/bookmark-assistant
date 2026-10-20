// Server API Client for Bookmark Notion Sync Extension
// Handles all communication with the backend server
import { productConfig } from '../product-config';
import {
  NOTION_CONNECTED_KEY,
  readSessionExpiry,
  shouldRenewSession,
  ACCOUNT_REVISION_KEY,
  readAccountContext,
  assertAccountContextCurrent,
  isAccountContextCurrent,
  isStaleAccountStateError,
  mutateAccountState,
  withCurrentAccount,
  sameAccountContext,
  StaleAccountStateError,
  type AccountContext,
} from '../utils/account-state';
import { mapAccountProfile } from '../utils/account-profile';
import type { CurrentPageAiStatus } from '../utils/message';
import type {
  BookmarkSyncResponse,
  BookmarkSyncEnrichmentRequest,
  BookmarkSyncEnrichmentResponse,
  DeploymentProfile,
  LinkItem,
} from '@bookmark-assistant/types';
export type {
  BookmarkSyncResult as BookmarkSyncWriteResult,
  BookmarkSyncEnrichmentItem,
  BookmarkSyncEnrichmentResponse,
} from '@bookmark-assistant/types';
export interface ServerResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export type BookmarkData = LinkItem;

export interface LinkSyncPayload {
  bookmarks: BookmarkData[];
  readingList?: BookmarkData[];
  items?: BookmarkData[];
}

export type SubscriptionSource = 'paddle' | 'developer' | 'gift' | 'trial';

export interface UserProfile extends Partial<DeploymentProfile> {
  userId: string;
  isPro: boolean;
  plan: 'free' | 'pro';
  subscriptionSource: SubscriptionSource | null;
  expiresAt: string | null;
  purchaseType?: 'monthly' | 'yearly';
  [key: string]: any;
}

type UserProfileResponse = { user: UserProfile; isPro: boolean };

export type PublicPricing = {
  monthly: number;
  yearly: number;
  currencyCode?: string;
  source?: 'paddle' | 'configured-fallback';
};

export function parsePublicPricing(value: unknown): PublicPricing | null {
  if (!value || typeof value !== 'object') return null;
  const pricing = value as Partial<PublicPricing>;
  if (
    typeof pricing.monthly !== 'number' ||
    !Number.isFinite(pricing.monthly) ||
    pricing.monthly <= 0 ||
    typeof pricing.yearly !== 'number' ||
    !Number.isFinite(pricing.yearly) ||
    pricing.yearly <= 0
  ) {
    return null;
  }
  return pricing as PublicPricing;
}

const USER_PROFILE_CACHE_MS = 30_000;
const SESSION_RENEWAL_ENDPOINT = '/api/oauth/session';

const ENRICHMENT_STATE_KEYS = ['sync_enrichment_job', 'sync_enrichment_state'];
const AUTO_SYNC_KEYS = ['auto_sync_enabled', 'auto_sync_interval_minutes', 'sync_interval_hours'];
const ACCOUNT_STATE_KEYS = [
  'session_token',
  'user_id',
  'user_email',
  NOTION_CONNECTED_KEY,
  'is_pro',
  'purchase_type',
  'subscription_source',
  'subscription_expires_at',
  'entitlements_cached_at',
  'deployment_profile',
];
const SYNC_PROGRESS_KEYS = [
  'last_sync',
  'last_sync_at',
  'last_sync_summary',
  'last_sync_count',
  'last_sync_fingerprint',
  'last_sync_payload_version',
  'last_sync_hash',
  'sync_in_progress',
  ...ENRICHMENT_STATE_KEYS,
  'sync_started_at',
  'sync_trigger',
  'last_bulk_sync',
  'last_sync_results',
];
// A destination change resets its sync progress; disconnect retains account and plan.
const DESTINATION_SYNC_STATE_KEYS = [
  'oauth_template_database_id',
  ...SYNC_PROGRESS_KEYS,
  'is_connecting',
  ...AUTO_SYNC_KEYS,
  'last_reading_list_debug',
  'dashboard_snapshot',
  'dashboard_connection',
];
const USER_PROFILE_FAILURE_BACKOFF_MS = 30_000;
export const BULK_SYNC_REQUEST_TIMEOUT_MS = 10 * 60_000;
export const SINGLE_ITEM_SYNC_REQUEST_TIMEOUT_MS = 90_000;

class ServerAPIClient {
  private baseUrl: string;
  private sessionToken: string | null = null;
  private sessionRenewal: Promise<void> | null = null;
  private profileRequestVersion = 0;
  private userProfileCache: {
    context: AccountContext;
    sessionToken: string;
    expiresAt: number;
    value: UserProfileResponse;
  } | null = null;
  private userProfileRequest: {
    context: AccountContext;
    sessionToken: string;
    promise: Promise<UserProfileResponse>;
  } | null = null;
  private userProfileFailure: {
    context: AccountContext;
    sessionToken: string;
    retryAt: number;
    error: unknown;
  } | null = null;

  constructor() {
    this.baseUrl = productConfig.apiUrl;
  }

  private async loadSessionToken() {
    await mutateAccountState(async () => {
      const result = await chrome.storage.local.get(['session_token']);
      const nextSessionToken =
        typeof result.session_token === 'string' ? result.session_token : null;
      if (nextSessionToken !== this.sessionToken) this.clearUserProfileCache();
      this.sessionToken = nextSessionToken;
    });
  }

  private clearUserProfileCache() {
    this.profileRequestVersion++;
    this.sessionRenewal = null;
    this.userProfileCache = null;
    this.userProfileRequest = null;
    this.userProfileFailure = null;
  }

  // todo - find a better way to make request
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit & { timeoutMs?: number } = {},
    expectedContext?: AccountContext
  ): Promise<T> {
    const context = expectedContext ?? (await readAccountContext());
    // Always reload token before requests to pick up changes after OAuth
    await this.loadSessionToken();
    if (endpoint !== SESSION_RENEWAL_ENDPOINT) await this.renewSessionIfNeeded();
    const requestContext = await readAccountContext();
    // Validate the initiating account before sending, not only on completion.
    // Pricing is public and can still load after an expired local session clears.
    if (endpoint !== '/api/pricing' && !sameAccountContext(context, requestContext)) {
      throw new StaleAccountStateError();
    }
    const requestToken = requestContext.token;
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Extension-ID': chrome.runtime.id,
      ...((options.headers as Record<string, string>) || {}),
    };
    // The Notion exchange carries the session too, so Notion links to the signed-in account.
    if (requestToken) {
      headers['Authorization'] = `Bearer ${requestToken}`;
    }

    // Default timeout: 30s for most operations, 0 (disabled) for critical ops
    // Critical ops (OAuth, first-time sync) should pass timeoutMs: 0
    const { timeoutMs = 30000, ...rest } = options as any;
    const controller = new AbortController();
    const useTimeout = typeof timeoutMs === 'number' && timeoutMs > 0;
    const timeout = useTimeout ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await globalThis.fetch(url, {
        cache: 'no-store',
        ...rest,
        headers,
        signal: useTimeout ? controller.signal : undefined,
      });
      if (timeout) clearTimeout(timeout);

      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');
      const data = (isJson ? await response.json() : { message: await response.text() }) as any;
      await assertAccountContextCurrent(requestContext);
      if (!response.ok) {
        const message = data?.message || data?.error || `Server error: ${response.status}`;
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;
        const err = new APIError(message, response.status, retryAfterSeconds);
        // Attach server-provided code if any
        if (data?.code) (err as any).code = data.code;
        if (response.status === 401 && isSessionAuthError(message)) {
          await this.clearLocalSession(requestContext, requestToken);
        }
        throw err;
      }
      return data as T;
    } catch (error: any) {
      if (timeout) clearTimeout(timeout);
      if (!(error instanceof APIError)) await assertAccountContextCurrent(requestContext);
      if (error?.name === 'AbortError') {
        const timeoutSeconds = Math.round(timeoutMs / 1000);
        console.warn(
          `[ServerAPI] Request to ${endpoint} timed out after ${timeoutSeconds}s. ` +
            `This might be due to slow network or server processing.`
        );

        // Log timeouts to backend for monitoring (all timeouts are noteworthy)
        if (timeoutMs > 0 && productConfig.officialService) {
          try {
            globalThis.fetch(`${this.baseUrl}/api/client-log`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Extension-ID': chrome.runtime.id },
              body: JSON.stringify({
                level: 'warn',
                message: 'REQUEST_TIMEOUT',
                meta: { endpoint, timeoutMs },
              }),
              cache: 'no-store',
            });
          } catch {}
        }

        // Provide helpful error message
        throw new Error(
          `Sync request timed out after ${timeoutSeconds}s. The server might be busy processing your bookmarks. Please try again later.`
        );
      }
      throw error;
    }
  }

  /**
   * Keeps an active account signed in. Failures are left to the request that
   * follows; an expired session is cleared by the normal 401 handling.
   */
  private async renewSessionIfNeeded(): Promise<void> {
    const token = this.sessionToken;
    if (!token) return;
    const expiresAt = readSessionExpiry(token);
    if (expiresAt !== null && expiresAt <= Date.now()) {
      // An expired session would reject the request (and waste a one-time OAuth code).
      const context = await readAccountContext();
      if (context.token !== token) return;
      await this.clearLocalSession(context, token);
      return;
    }
    if (!shouldRenewSession(token)) return;
    if (!this.sessionRenewal) {
      const renewal = (async () => {
        const context = await readAccountContext();
        const response = await this.makeRequest<{ sessionToken?: string }>(
          SESSION_RENEWAL_ENDPOINT,
          {
            method: 'POST',
            timeoutMs: 10_000,
          }
        );
        if (!response.sessionToken || this.sessionToken !== token) return;
        await withCurrentAccount(context, async () => {
          this.sessionToken = response.sessionToken!;
          await chrome.storage.local.set({ session_token: response.sessionToken });
        });
      })()
        .catch((error) => {
          if (!isStaleAccountStateError(error))
            console.warn('[ServerAPI] Session renewal failed:', error);
        })
        .finally(() => {
          if (this.sessionRenewal === renewal) this.sessionRenewal = null;
        });
      this.sessionRenewal = renewal;
    }
    await this.sessionRenewal;
  }

  // 🔌 Remove the Notion destination; the account and its plan stay.
  async disconnectNotion(expectedContext?: AccountContext): Promise<AccountContext> {
    const context = expectedContext ?? (await readAccountContext());
    await this.makeRequest(
      '/api/user/notion/disconnect',
      { method: 'POST', timeoutMs: 10_000 },
      context
    );
    return withCurrentAccount(context, async () => {
      this.clearUserProfileCache();
      const current = await readAccountContext();
      const revision = crypto.randomUUID();
      await chrome.storage.local.set({
        [ACCOUNT_REVISION_KEY]: revision,
        [NOTION_CONNECTED_KEY]: false,
        auto_sync_enabled: false,
      });
      await chrome.storage.local.remove(DESTINATION_SYNC_STATE_KEYS);
      return { ...current, revision };
    });
  }

  // 🗑️ Permanently delete the service account, then sign out locally.
  async deleteAccount(expectedContext?: AccountContext): Promise<AccountContext> {
    const context = expectedContext ?? (await readAccountContext());
    await this.makeRequest('/api/user/account', { method: 'DELETE', timeoutMs: 10_000 }, context);
    return this.logout(context);
  }

  // 🔐 OAuth Token Exchange (Server-first, secure)
  async exchangeOAuthCode(
    code: string,
    redirectUri: string,
    expectedContext?: AccountContext
  ): Promise<{
    sessionToken: string;
    user: { userId: string; userEmail?: string; templateDatabaseId?: string | null };
    accountRevision: string;
  }> {
    try {
      let context = expectedContext ?? (await readAccountContext());
      await assertAccountContextCurrent(context);
      const expiry = context.token ? readSessionExpiry(context.token) : null;
      if (expiry !== null && expiry <= Date.now()) {
        context = await this.clearLocalSession(context, context.token);
      }
      // No timeout for OAuth - this is critical and can be slow due to Notion API calls
      const response = await this.makeRequest<any>(
        '/api/oauth/exchange',
        {
          method: 'POST',
          timeoutMs: 0, // Disable timeout for critical OAuth operation
          body: JSON.stringify({
            code,
            redirectUri,
            extensionUserId: chrome.runtime.id,
          }),
        },
        context
      );

      if (!response.sessionToken) {
        throw new Error('Server did not return a session token');
      }

      const toStore: Record<string, any> = {
        [ACCOUNT_REVISION_KEY]: crypto.randomUUID(),
        session_token: response.sessionToken,
        user_id: response.userId,
        [NOTION_CONNECTED_KEY]: true,
      };
      if (response.userEmail) {
        toStore.user_email = response.userEmail;
      }
      if (response.templateDatabaseId) {
        toStore.oauth_template_database_id = response.templateDatabaseId;
      }
      await withCurrentAccount(context, async () => {
        this.clearUserProfileCache();
        this.sessionToken = response.sessionToken;
        await chrome.storage.local.set(toStore);

        // A successful OAuth exchange can point this extension at a freshly
        // duplicated Notion database. The prior connection's content fingerprint
        // is not evidence that this database has received those items, so it must
        // never short-circuit the first sync after connecting or reconnecting.
        await chrome.storage.local.remove([
          ...SYNC_PROGRESS_KEYS,
          'last_sync_error',
          'dashboard_last_sync',
          'dashboard_recent_activity',
          'dashboard_saved_today',
          'dashboard_snapshot',
        ]);
      });

      return {
        sessionToken: response.sessionToken,
        accountRevision: toStore[ACCOUNT_REVISION_KEY],
        user: {
          userId: response.userId,
          userEmail: response.userEmail,
          templateDatabaseId: response.templateDatabaseId,
        },
      };
    } catch (error: any) {
      throw error;
    }
  }

  async syncBookmarks(
    bookmarksOrPayload: BookmarkData[] | LinkSyncPayload,
    options: {
      aiBatchEligible?: boolean;
      deferEnhancements?: boolean;
      requestTimeoutMs?: number;
    } = {},
    context?: AccountContext
  ): Promise<BookmarkSyncResponse> {
    // A first sync can legitimately take several minutes while the server
    // extracts descriptions and writes each Notion page. Keep a bounded
    // watchdog so a stalled request still reaches the normal recovery path.
    const {
      requestTimeoutMs = BULK_SYNC_REQUEST_TIMEOUT_MS,
      deferEnhancements,
      ...requestOptions
    } = options;
    const payload = Array.isArray(bookmarksOrPayload)
      ? buildLinkSyncPayload(bookmarksOrPayload)
      : bookmarksOrPayload;
    return await this.makeRequest<BookmarkSyncResponse>(
      '/api/bookmarks/sync',
      {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          ...requestOptions,
          ...(deferEnhancements !== undefined ? { options: { deferEnhancements } } : {}),
        }),
        timeoutMs: requestTimeoutMs,
      },
      context
    );
  }

  async enrichBookmarks(
    input: BookmarkSyncEnrichmentRequest,
    context?: AccountContext
  ): Promise<BookmarkSyncEnrichmentResponse> {
    return this.makeRequest(
      '/api/bookmarks/enrich',
      {
        method: 'POST',
        body: JSON.stringify(input),
        timeoutMs: BULK_SYNC_REQUEST_TIMEOUT_MS,
      },
      context
    );
  }

  async generateCurrentPage(input: {
    knowledgeItemId: string;
    syncId: string;
    url: string;
    body: string;
  }): Promise<{ status: CurrentPageAiStatus }> {
    return this.makeRequest('/api/ai/current-page', {
      method: 'POST',
      body: JSON.stringify(input),
      timeoutMs: 75_000,
    });
  }

  async getAiSettings(): Promise<{
    settings: null | {
      singlePageEnabled: boolean;
      batchEnabled: boolean;
      properties?: { descriptionPropertyId: string; tagsPropertyId: string };
    };
  }> {
    return this.makeRequest('/api/ai/settings', { method: 'GET' });
  }
  async getAiCredential(): Promise<{
    credential: null | {
      provider: 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'groq' | 'minimax';
      keyLastFour: string;
      status: 'verified' | 'invalid' | 'revoked';
    };
    providerModels: Record<
      'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'groq' | 'minimax',
      string
    >;
  }> {
    return this.makeRequest('/api/ai/credential', { method: 'GET' });
  }
  async saveAiCredential(
    provider: 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'groq' | 'minimax',
    apiKey: string
  ): Promise<any> {
    return this.makeRequest('/api/ai/credential', {
      method: 'PUT',
      body: JSON.stringify({ provider, apiKey }),
      timeoutMs: 30_000,
    });
  }
  async deleteAiCredential(): Promise<void> {
    await this.makeRequest('/api/ai/credential', { method: 'DELETE' });
  }
  async saveAiSettings(settings: {
    singlePageEnabled: boolean;
    batchEnabled: boolean;
  }): Promise<{ success: boolean }> {
    return this.makeRequest('/api/ai/settings', { method: 'PUT', body: JSON.stringify(settings) });
  }
  async getRecentAiProcessing(): Promise<{
    tasks: Array<{
      id: string;
      status: string;
      reasonCode?: string | null;
      mode: string;
      createdAt: string;
      completedAt?: string | null;
    }>;
  }> {
    return this.makeRequest('/api/ai/recent-processing', { method: 'GET' });
  }
  async getPendingAiSummary(): Promise<{
    pending: number;
    ready?: number;
    retryable?: number;
    scheduled?: number;
    processing?: number;
    blocked?: number;
  }> {
    return this.makeRequest('/api/ai/pending-summary', { method: 'GET' });
  }
  async runPendingAi(): Promise<{
    processed: number;
    remaining: number;
    confirmedBatches: number;
    succeeded: number;
    skipped: number;
    failed: number;
    needsAction: number;
  }> {
    return this.makeRequest('/api/ai/run-pending', { method: 'POST', timeoutMs: 45_000 });
  }

  async getUserProfile(
    options: { forceRefresh?: boolean } = {},
    expectedContext?: AccountContext
  ): Promise<UserProfileResponse> {
    const context = expectedContext ?? (await readAccountContext());
    await assertAccountContextCurrent(context);
    await this.loadSessionToken();
    if (!this.sessionToken) throw new APIError('Session token required', 401);
    await this.renewSessionIfNeeded();
    const sessionToken = this.sessionToken;
    if (!sessionToken) throw new APIError('Session token required', 401);
    await assertAccountContextCurrent(context);

    if (
      this.userProfileRequest?.sessionToken === sessionToken &&
      sameAccountContext(this.userProfileRequest.context, context)
    ) {
      return this.userProfileRequest.promise;
    }

    const cached = this.userProfileCache;
    if (
      !options.forceRefresh &&
      cached?.sessionToken === sessionToken &&
      sameAccountContext(cached.context, context) &&
      cached.expiresAt > Date.now()
    ) {
      return cached.value;
    }

    const recentFailure = this.userProfileFailure;
    if (
      !options.forceRefresh &&
      recentFailure?.sessionToken === sessionToken &&
      sameAccountContext(recentFailure.context, context) &&
      recentFailure.retryAt > Date.now()
    ) {
      throw recentFailure.error;
    }

    const requestVersion = ++this.profileRequestVersion;
    const request = this.makeRequest<any>('/api/user/profile', {}, context)
      .then(async (res) => {
        const value = { user: res.profile, isPro: res.profile.isPro };
        await withCurrentAccount(context, async () => {
          if (requestVersion !== this.profileRequestVersion) throw new StaleAccountStateError();
          const profile = mapAccountProfile(res.profile, this.baseUrl);
          // One background commit owns connection and entitlement cache writes.
          await chrome.storage.local.set({
            ...profile.cache,
            [NOTION_CONNECTED_KEY]: !!res.profile.hasNotionAccess,
            ...(res.profile.email ? { user_email: res.profile.email } : {}),
          });
          if (requestVersion !== this.profileRequestVersion) throw new StaleAccountStateError();
          this.userProfileFailure = null;
          this.userProfileCache = {
            context,
            sessionToken: this.sessionToken!,
            expiresAt: Date.now() + USER_PROFILE_CACHE_MS,
            value,
          };
        });
        return value;
      })
      .catch(async (error) => {
        if (
          !isStaleAccountStateError(error) &&
          (await isAccountContextCurrent(context)) &&
          requestVersion === this.profileRequestVersion
        ) {
          this.userProfileFailure = {
            context,
            sessionToken,
            retryAt: Date.now() + USER_PROFILE_FAILURE_BACKOFF_MS,
            error,
          };
        }
        throw error;
      });

    const trackedRequest = request.finally(() => {
      if (this.userProfileRequest?.promise === trackedRequest) {
        this.userProfileRequest = null;
      }
    });
    this.userProfileRequest = { context, sessionToken, promise: trackedRequest };
    return trackedRequest;
  }

  async getPricing(): Promise<{ pricing: PublicPricing }> {
    const res = await this.makeRequest<{ pricing: unknown }>('/api/pricing', {
      method: 'GET',
      timeoutMs: 5000,
    });
    const pricing = parsePublicPricing(res.pricing);
    if (!pricing) {
      throw new Error('The pricing service returned an unsupported response.');
    }
    return { pricing };
  }

  async restorePurchase(email: string): Promise<{ success: boolean; message?: string }> {
    return await this.makeRequest<any>('/api/user/restore-purchase', {
      method: 'POST',
      body: JSON.stringify({ email }),
      timeoutMs: 10000,
    });
  }

  async getPortalLink(): Promise<{ success: boolean; url?: string; error?: string }> {
    return await this.makeRequest<any>('/api/paddle/portal-session', {
      method: 'POST',
      timeoutMs: 10000,
    });
  }

  async cancelSubscription(): Promise<{ success: boolean; error?: string }> {
    return await this.makeRequest<any>('/api/paddle/cancel-subscription', {
      method: 'POST',
      timeoutMs: 10000,
    });
  }

  async getSubscriptionInfo(): Promise<{
    success: boolean;
    nextBillingDate?: string;
    status?: string;
    error?: string;
  }> {
    return await this.makeRequest<any>('/api/paddle/subscription-info', {
      method: 'GET',
      timeoutMs: 10000,
    });
  }

  // 🚪 Clear this device's account session.
  // Local cleanup after the account is deleted. Sessions are stateless, so no
  // server call is needed; the legacy /api/user/logout endpoint now only
  // disconnects Notion for older extensions.
  async logout(context?: AccountContext): Promise<AccountContext> {
    return mutateAccountState(async () => {
      if (context) await assertAccountContextCurrent(context);
      this.clearUserProfileCache();
      this.sessionToken = null;
      const revision = crypto.randomUUID();
      await chrome.storage.local.set({ [ACCOUNT_REVISION_KEY]: revision });
      await chrome.storage.local.remove([...DESTINATION_SYNC_STATE_KEYS, ...ACCOUNT_STATE_KEYS]);
      return { revision, token: null, userId: null };
    });

    // Note: We intentionally preserve:
    // - bookmark_library_metadata_v1 (local descriptions and tags)
    // - cached_pricing (avoids unnecessary refetch)
  }

  private async clearLocalSession(
    context?: AccountContext,
    requestToken?: string | null
  ): Promise<AccountContext> {
    return mutateAccountState(async () => {
      if (context) {
        await assertAccountContextCurrent(context);
        const current = await readAccountContext();
        if (current.token !== requestToken) throw new StaleAccountStateError();
      }
      this.clearUserProfileCache();
      this.sessionToken = null;
      const revision = crypto.randomUUID();
      await chrome.storage.local.set({ [ACCOUNT_REVISION_KEY]: revision });
      await chrome.storage.local.remove([
        ...ACCOUNT_STATE_KEYS,
        'oauth_template_database_id',
        'is_connecting',
        ...ENRICHMENT_STATE_KEYS,
        ...AUTO_SYNC_KEYS,
        'dashboard_snapshot',
        'dashboard_connection',
      ]);
      await chrome.storage.local.set({
        is_pro: false,
        auto_sync_enabled: false,
        sync_in_progress: false,
        sync_started_at: null,
        sync_trigger: null,
      });
      return { revision, token: null, userId: null };
    });
  }
}

function isSessionAuthError(message: string): boolean {
  return /session token (expired|required)|invalid session token|malformed session token/i.test(
    message
  );
}

function buildLinkSyncPayload(items: BookmarkData[]): LinkSyncPayload {
  const bookmarks = items.filter((item) => item.type !== 'reading_list');
  const readingList = items.filter((item) => item.type === 'reading_list');

  return {
    bookmarks,
    readingList,
    items,
  };
}

// Export singleton instance
export const serverAPI = new ServerAPIClient();

// Structured error carrying HTTP status and retry hints
export class APIError extends Error {
  status: number;
  retryAfterSeconds?: number;
  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.retryAfterSeconds = Number.isFinite(retryAfterSeconds || NaN)
      ? (retryAfterSeconds as number)
      : undefined;
  }
}

// Helper function to convert Chrome bookmarks to server format
export function formatBookmarkForServer(
  bookmark: chrome.bookmarks.BookmarkTreeNode,
  path: string
): BookmarkData {
  // Use stable syncId based on Chrome bookmark ID
  // This ensures the same bookmark gets the same syncId across multiple syncs
  // which is critical for duplicate detection on the server side
  const syncId = bookmark.id; // Chrome bookmark ID is stable across sessions

  return {
    title: bookmark.title || 'Untitled',
    url: bookmark.url || '',
    description: `Imported from Chrome bookmarks`,
    path: path,
    dateAdded: bookmark.dateAdded
      ? new Date(bookmark.dateAdded).toISOString()
      : new Date().toISOString(),
    syncId,
    source: 'chrome_bookmark',
  };
}

// REMOVED: syncAllBookmarksViaServer - this function was unused and contained
// chrome.notifications API calls that required the 'notifications' permission.
// Bookmark syncing is now handled by performBookmarkSync in background/index.ts
