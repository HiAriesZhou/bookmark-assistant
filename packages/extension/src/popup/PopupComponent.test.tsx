// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createTestRoot, cleanupTestRoot, type TestRoot } from '../testing/react-root';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../options/hook/ToastProvider';
import { useAppStore } from '../options/store';
import type { DashboardSnapshot } from '../dashboard/types';
import Popup from './PopupComponent';

const originalState = useAppStore.getState();
let container: HTMLDivElement;
let root: TestRoot;

const dashboard = (status: DashboardSnapshot['connection']['status']): DashboardSnapshot => ({
  generatedAt: '2026-09-11T00:00:00.000Z',
  connection: {
    status,
    provider: { id: 'notion', displayName: 'Notion' },
  },
  library: { bookmarks: 71, readingList: 98, savedToday: 0, duplicatesSkipped: 0 },
  libraryHealth: {
    version: 1,
    bookmarkCount: 71,
    userFolderCount: 0,
    readingListCount: 98,
    duplicateGroupCount: 0,
    duplicateExtraItemCount: 0,
    topLevelUncategorizedCount: 0,
    largestFolderItemCount: 0,
    estimatedLocalSyncItems: 71,
  },
  sync: {
    inProgress: false,
    autoSyncEnabled: false,
    failedCount: 0,
    lastSyncAt: '2026-09-10T23:00:00.000Z',
    lastResult: 'success',
  },
  recentActivity: [],
});

const renderPopup = async () => {
  await act(async () => {
    root.render(
      <ToastProvider>
        <Popup />
      </ToastProvider>
    );
  });
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', {
    i18n: {
      getMessage: (key: string) => key,
      getUILanguage: () => 'en',
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      openOptionsPage: vi.fn(),
    },
    tabs: { create: vi.fn(async () => undefined) },
  });
  vi.spyOn(window, 'close').mockImplementation(() => undefined);
  ({ container, root } = createTestRoot());
});

afterEach(async () => {
  await cleanupTestRoot(root, container);
  useAppStore.setState(originalState);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('refreshes its dashboard once after cached state has hydrated', async () => {
  const refreshDashboard = vi.fn(async () => undefined);
  useAppStore.setState({ hydrationState: 'booting', refreshDashboard });
  await act(async () => {
    root.render(
      <StrictMode>
        <ToastProvider>
          <Popup />
        </ToastProvider>
      </StrictMode>
    );
  });
  expect(refreshDashboard).not.toHaveBeenCalled();

  await act(async () => {
    useAppStore.setState({ hydrationState: 'cached' });
  });

  expect(refreshDashboard).toHaveBeenCalledTimes(1);
  expect(refreshDashboard).toHaveBeenCalledWith(false);
});

it('shows the local library without destination controls when disconnected', async () => {
  useAppStore.setState({
    hydrationState: 'cached',
    isConnected: false,
    dashboard: dashboard('disconnected'),
    refreshDashboard: vi.fn(async () => undefined),
  });

  await renderPopup();

  expect(container.textContent).toContain('popup_library');
  expect(container.textContent).toContain('popup_bookmark_count');
  expect(container.textContent).not.toContain('Notion');
  expect(container.querySelector('[aria-label="syncNow"]')).toBeNull();
  expect(container.textContent).not.toContain('saveCurrentPage');
});

it('runs destination sync when connected', async () => {
  const syncNow = vi.fn(async () => ({ noChanges: true }));
  useAppStore.setState({
    hydrationState: 'cached',
    isConnected: true,
    isSyncing: false,
    dashboard: dashboard('connected'),
    refreshDashboard: vi.fn(async () => undefined),
    syncNow,
  });

  await renderPopup();

  await act(async () => {
    container.querySelector<HTMLButtonElement>('[aria-label="syncNow"]')?.click();
  });
  expect(syncNow).toHaveBeenCalledOnce();
});

it('opens the local library and settings at their explicit routes', async () => {
  useAppStore.setState({
    hydrationState: 'cached',
    isConnected: false,
    dashboard: dashboard('disconnected'),
    refreshDashboard: vi.fn(async () => undefined),
  });

  await renderPopup();

  const libraryButton = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('popup_library')
  );
  await act(async () => libraryButton?.click());
  expect(chrome.tabs.create).toHaveBeenCalledWith({
    url: 'chrome-extension://test/options.html#/library',
  });

  await act(async () => {
    container.querySelector<HTMLButtonElement>('[aria-label="popup_open_settings"]')?.click();
  });
  expect(chrome.tabs.create).toHaveBeenCalledWith({
    url: 'chrome-extension://test/options.html#/settings',
  });
});
