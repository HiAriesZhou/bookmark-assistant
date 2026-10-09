// Server API Client for Bookmark Notion Sync Extension
// Handles all communication with the backend server
import { productConfig } from '../product-config';
import type { DeploymentProfile } from '@bookmark-assistant/types';
export interface ServerResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface BookmarkData {
  title: string;
  url: string;
  description?: string;
  path?: string;
  tags?: string[];
  dateAdded?: string;
  syncId?: string;
  type?: 'bookmark' | 'reading_list';
  readState?: 'UNREAD' | 'READ';
  source?: 'chrome_bookmark' | 'reading_list' | 'current_page' | 'context_menu' | 'import';
}

export interface LinkSyncPayload {
  bookmarks: BookmarkData[];
  readingList?: BookmarkData[];
  items?: BookmarkData[];
}

export type BookmarkSyncWriteResult = {
  success: boolean;
  bookmark: string;
  action?: 'created' | 'updated' | 'skipped';
  syncId?: string;
  notionPageId?: string;
  error?: string;
};

export type BookmarkSyncEnrichmentItem = {
  title: string;
  url: string;
  syncId: string;
  notionPageId: string;
  action: 'created' | 'updated';
  description?: string;
  source?: BookmarkData['source'];
};

export type BookmarkSyncEnrichmentResponse = {
  summary: {
    total: number;
    generated: number;
    alreadyPresent: number;
    unavailable: number;
    targetSkipped: number;
    failed: number;
  };
  aiPlanning: {
    status: 'planned' | 'not_eligible' | 'failed';
    taskCount?: number;
  };
};

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
const USER_PROFILE_FAILURE_BACKOFF_MS = 30_000;
export const BULK_SYNC_REQUEST_TIMEOUT_MS = 10 * 60_000;
export const SINGLE_ITEM_SYNC_REQUEST_TIMEOUT_MS = 90_000;

class ServerAPIClient {
  private baseUrl: string;
  private sessionToken: string | null = null;
  private userProfileCache: {
    sessionToken: string;
    expiresAt: number;
    value: UserProfileResponse;
  } | null = null;
  private userProfileRequest: {
    sessionToken: string;
    promise: Promise<UserProfileResponse>;
  } | null = null;
  private userProfileFailure: {
    sessionToken: string;
    retryAt: number;
    error: unknown;
  } | null = null;

  constructor() {
    this.baseUrl = productConfig.apiUrl;
    void this.loadSessionToken().catch(() => {
      this.sessionToken = null;
    });
  }

  private async loadSessionToken() {
    const result = await chrome.storage.local.get(['session_token']);
    const nextSessionToken = result.session_token || null;
    if (nextSessionToken !== this.sessionToken) {
      this.clearUserProfileCache();
    }
    this.sessionToken = nextSessionToken;
  }

  private clearUserProfileCache() {
    this.userProfileCache = null;
    this.userProfileRequest = null;
    this.userProfileFailure = null;
  }

  // todo - find a better way to make request
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit & { timeoutMs?: number } = {}
  ): Promise<T> {
    // Always reload token before requests to pick up changes after OAuth
    await this.loadSessionToken();
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Extension-ID': chrome.runtime.id,
      ...((options.headers as Record<string, string>) || {}),
    };
    if (this.sessionToken && !endpoint.includes('/api/oauth/exchange')) {
      headers['Authorization'] = `Bearer ${this.sessionToken}`;
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
      if (!response.ok) {
        const message = data?.message || data?.error || `Server error: ${response.status}`;
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;
        const err = new APIError(message, response.status, retryAfterSeconds);
        // Attach server-provided code if any
        if (data?.code) (err as any).code = data.code;
        if (response.status === 401 && isSessionAuthError(message)) {
          await this.clearLocalSession();
        }
        throw err;
      }
      return data as T;
    } catch (error: any) {
      if (timeout) clearTimeout(timeout);
      if (error?.name === 'AbortError') {
        const timeoutSeconds = Math.round(timeoutMs / 1000);
        console.warn(
          `[ServerAPI] Request to ${endpoint} timed out after ${timeoutSeconds}s. ` +
            `This might be due to slow network or server processing.`
        );

        // Log timeouts to backend for monitoring (all timeouts are noteworthy)
        if (timeoutMs > 0 && productConfig.profile === 'official') {
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

  // 🔐 OAuth Token Exchange (Server-first, secure)
  async exchangeOAuthCode(
    code: string,
    redirectUri: string
  ): Promise<{
    sessionToken: string;
    user: { userId: string; userEmail?: string; templateDatabaseId?: string | null };
  }> {
    try {
      // No timeout for OAuth - this is critical and can be slow due to Notion API calls
      const response = await this.makeRequest<any>('/api/oauth/exchange', {
        method: 'POST',
        timeoutMs: 0, // Disable timeout for critical OAuth operation
        body: JSON.stringify({
          code,
          redirectUri,
          extensionUserId: chrome.runtime.id,
        }),
      });

      if (!response.sessionToken) {
        throw new Error('Server did not return a session token');
      }

      this.clearUserProfileCache();
      this.sessionToken = response.sessionToken;
      const toStore: Record<string, any> = {
        session_token: response.sessionToken,
        user_id: response.userId,
      };
      if (response.userEmail) {
        toStore.user_email = response.userEmail;
      }
      if (response.templateDatabaseId) {
        toStore.oauth_template_database_id = response.templateDatabaseId;
      }
      await chrome.storage.local.set(toStore);

      // A successful OAuth exchange can point this extension at a freshly
      // duplicated Notion database. The prior connection's content fingerprint
      // is not evidence that this database has received those items, so it must
      // never short-circuit the first sync after connecting or reconnecting.
      await chrome.storage.local.remove([
        'last_sync',
        'last_sync_at',
        'last_sync_summary',
        'last_sync_count',
        'last_sync_fingerprint',
        'last_sync_payload_version',
        'last_sync_hash',
        'sync_in_progress',
        'sync_enrichment_job',
        'sync_enrichment_state',
        'sync_started_at',
        'sync_trigger',
        'last_sync_error',
        'last_bulk_sync',
        'last_sync_results',
        'dashboard_last_sync',
        'dashboard_recent_activity',
        'dashboard_saved_today',
        'dashboard_snapshot',
      ]);

      return {
        sessionToken: response.sessionToken,
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
    } = {}
  ): Promise<{
    summary: {
      total: number;
      success: number;
      failed: number;
      skippedExisting?: number;
      duplicatesBySyncId?: number;
      duplicatesByUrl?: number;
      updated?: number;
      readingListTotal?: number;
      readingListSuccess?: number;
      readingListFailed?: number;
      readingListSkippedExisting?: number;
      descriptionSkippedByBudget?: number;
      deferred?: number;
    };
    results: BookmarkSyncWriteResult[];
    aiPlanning?: {
      status: 'planned' | 'not_eligible' | 'failed';
      taskCount?: number;
    };
    partialSync?: {
      applied: number;
      requested: number;
      processed: number;
      skipped: number;
      message: string;
    };
    enrichment?: {
      items: BookmarkSyncEnrichmentItem[];
      aiBatchEligible?: boolean;
    };
  }> {
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
    return await this.makeRequest<any>('/api/bookmarks/sync', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        ...requestOptions,
        ...(deferEnhancements !== undefined ? { options: { deferEnhancements } } : {}),
      }),
      timeoutMs: requestTimeoutMs,
    });
  }

  async enrichBookmarks(input: {
    items: BookmarkSyncEnrichmentItem[];
    aiBatchEligible?: boolean;
  }): Promise<BookmarkSyncEnrichmentResponse> {
    return this.makeRequest('/api/bookmarks/enrich', {
      method: 'POST',
      body: JSON.stringify(input),
      timeoutMs: BULK_SYNC_REQUEST_TIMEOUT_MS,
    });
  }

  async generateCurrentPage(input: {
    knowledgeItemId: string;
    syncId: string;
    url: string;
    body: string;
  }): Promise<{ status: string }> {
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

  async getUserProfile(options: { forceRefresh?: boolean } = {}): Promise<UserProfileResponse> {
    await this.loadSessionToken();
    const sessionToken = this.sessionToken;

    if (!sessionToken) {
      throw new APIError('Session token required', 401);
    }

    if (this.userProfileRequest?.sessionToken === sessionToken) {
      return this.userProfileRequest.promise;
    }

    const cached = this.userProfileCache;
    if (
      !options.forceRefresh &&
      cached?.sessionToken === sessionToken &&
      cached.expiresAt > Date.now()
    ) {
      return cached.value;
    }

    const recentFailure = this.userProfileFailure;
    if (
      !options.forceRefresh &&
      recentFailure?.sessionToken === sessionToken &&
      recentFailure.retryAt > Date.now()
    ) {
      throw recentFailure.error;
    }

    const request = this.makeRequest<any>('/api/user/profile')
      .then((res) => {
        const value = { user: res.profile, isPro: res.profile.isPro };
        if (this.sessionToken === sessionToken) {
          this.userProfileFailure = null;
          this.userProfileCache = {
            sessionToken,
            expiresAt: Date.now() + USER_PROFILE_CACHE_MS,
            value,
          };
        }
        return value;
      })
      .catch((error) => {
        if (this.sessionToken === sessionToken) {
          this.userProfileFailure = {
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
    this.userProfileRequest = { sessionToken, promise: trackedRequest };
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

  async isConnected(): Promise<boolean> {
    try {
      await this.loadSessionToken();
      if (!this.sessionToken) return false;

      await this.getUserProfile();
      return true;
    } catch {
      return false;
    }
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

  // 🚪 Logout
  async logout(): Promise<void> {
    try {
      await this.makeRequest('/api/user/logout', { method: 'POST', timeoutMs: 5000 });
    } catch {}
    this.clearUserProfileCache();
    this.sessionToken = null;

    // Selective cleanup: Remove all authentication and session data
    // Note: We no longer preserve oauth_template_database_id because:
    // 1. Server-side recovery was removed (each reconnection creates a new database)
    // 2. The old template ID would cause stale cache issues
    const keysToRemove = [
      'session_token',
      'user_id',
      'user_email',
      'oauth_template_database_id', // Remove - no longer needed, causes stale cache
      'is_pro',
      'purchase_type',
      'entitlements_cached_at', // Clear entitlements cache on logout
      'deployment_profile',
      'last_sync',
      'last_sync_at',
      'last_sync_summary',
      'last_sync_count',
      'last_sync_fingerprint',
      'last_sync_payload_version',
      'last_sync_hash',
      'sync_in_progress',
      'sync_enrichment_job',
      'sync_enrichment_state',
      'sync_started_at',
      'sync_trigger',
      'is_connecting',
      'auto_sync_enabled',
      'auto_sync_interval_minutes',
      'sync_interval_hours',
      'last_bulk_sync',
      'last_sync_results',
      'last_reading_list_debug',
      'dashboard_snapshot',
    ];

    await chrome.storage.local.remove(keysToRemove);

    // Note: We intentionally preserve:
    // - description_cache_* keys (user's cached descriptions - expensive to rebuild)
    // - cached_pricing (avoids unnecessary refetch)
  }

  private async clearLocalSession(): Promise<void> {
    this.clearUserProfileCache();
    this.sessionToken = null;
    await chrome.storage.local.remove([
      'session_token',
      'user_id',
      'user_email',
      'oauth_template_database_id',
      'is_pro',
      'purchase_type',
      'subscription_source',
      'subscription_expires_at',
      'deployment_profile',
      'entitlements_cached_at',
      'is_connecting',
      'sync_enrichment_job',
      'sync_enrichment_state',
      'auto_sync_enabled',
      'auto_sync_interval_minutes',
      'sync_interval_hours',
      'dashboard_snapshot',
    ]);
    await chrome.storage.local.set({
      is_pro: false,
      auto_sync_enabled: false,
      sync_in_progress: false,
      sync_started_at: null,
      sync_trigger: null,
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
