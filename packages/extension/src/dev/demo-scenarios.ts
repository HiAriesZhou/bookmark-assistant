import type { DashboardSnapshot } from '../dashboard/types';

export const DEMO_SCENARIO_IDS = [
  'disconnected-report',
  'connected',
  'sync-success',
  'sync-in-progress',
  'save-page',
  'auto-sync',
] as const;
export type DemoScenarioId = (typeof DEMO_SCENARIO_IDS)[number];
export type DemoLocale = 'en' | 'zh-CN';

export interface DemoScenario {
  id: DemoScenarioId;
  dashboard: DashboardSnapshot;
}

export const DEFAULT_DEMO_TIME = '2026-07-20T10:00:00.000Z';

const minutesBefore = (now: number, minutes: number) =>
  new Date(now - minutes * 60_000).toISOString();
const hoursAfter = (now: number, hours: number) => new Date(now + hours * 3_600_000).toISOString();

function baseDashboard(now: number): DashboardSnapshot {
  return {
    generatedAt: new Date(now).toISOString(),
    connection: {
      provider: { id: 'notion', displayName: 'Notion' },
      status: 'connected',
      workspaceName: 'Demo Workspace',
      databaseName: 'Reading Library',
      checkedAt: minutesBefore(now, 2),
    },
    library: {
      bookmarks: 248,
      readingList: 17,
      savedToday: 6,
      duplicatesSkipped: 12,
    },
    libraryHealth: {
      version: 1,
      bookmarkCount: 248,
      userFolderCount: 24,
      readingListCount: 17,
      duplicateGroupCount: 8,
      duplicateExtraItemCount: 12,
      topLevelUncategorizedCount: 31,
      largestFolderItemCount: 46,
      estimatedLocalSyncItems: 253,
    },
    sync: {
      inProgress: false,
      lastSyncAt: minutesBefore(now, 18),
      lastResult: 'success',
      autoSyncEnabled: false,
      failedCount: 0,
    },
    recentActivity: [
      {
        id: 'activity-sync-success',
        occurredAt: minutesBefore(now, 18),
        kind: 'sync_completed',
        result: 'success',
        counts: { total: 253, success: 9, failed: 0, skipped: 12 },
      },
    ],
  };
}

export function createDemoScenarios(now: number): Record<DemoScenarioId, DemoScenario> {
  const connected = baseDashboard(now);
  const syncSuccess: DashboardSnapshot = {
    ...baseDashboard(now),
    library: { ...baseDashboard(now).library, savedToday: 9, duplicatesSkipped: 14 },
    sync: {
      ...baseDashboard(now).sync,
      lastSyncAt: minutesBefore(now, 2),
      lastResult: 'success',
    },
    recentActivity: [
      {
        id: 'activity-sync-fresh',
        occurredAt: minutesBefore(now, 2),
        kind: 'sync_completed',
        result: 'success',
        counts: { total: 255, success: 11, failed: 0, skipped: 14 },
      },
    ],
  };
  const disconnected: DashboardSnapshot = {
    ...baseDashboard(now),
    connection: { status: 'disconnected', action: 'connect' },
    library: { ...baseDashboard(now).library, savedToday: 0, duplicatesSkipped: 0 },
    sync: { inProgress: false, autoSyncEnabled: false, failedCount: 0 },
    recentActivity: [],
  };
  const syncInProgress: DashboardSnapshot = {
    ...baseDashboard(now),
    sync: {
      ...baseDashboard(now).sync,
      inProgress: true,
    },
  };
  const savePage: DashboardSnapshot = {
    ...baseDashboard(now),
    library: { ...baseDashboard(now).library, savedToday: 7 },
    recentActivity: [
      {
        id: 'activity-save-page',
        occurredAt: minutesBefore(now, 3),
        kind: 'save_completed',
        result: 'success',
        source: 'current_page',
        counts: { total: 1, success: 1, failed: 0, skipped: 0 },
      },
    ],
  };
  const autoSync: DashboardSnapshot = {
    ...baseDashboard(now),
    sync: {
      ...baseDashboard(now).sync,
      autoSyncEnabled: true,
      nextAutoSyncAt: hoursAfter(now, 6),
    },
  };

  return {
    'disconnected-report': { id: 'disconnected-report', dashboard: disconnected },
    connected: { id: 'connected', dashboard: connected },
    'sync-success': { id: 'sync-success', dashboard: syncSuccess },
    'sync-in-progress': { id: 'sync-in-progress', dashboard: syncInProgress },
    'save-page': { id: 'save-page', dashboard: savePage },
    'auto-sync': { id: 'auto-sync', dashboard: autoSync },
  };
}

export function parseDemoConfig(search: string): {
  scenarioId: DemoScenarioId;
  locale: DemoLocale;
  frozenTime: string;
} {
  const params = new URLSearchParams(search);
  const requestedScenario = params.get('scenario');
  const scenarioId = DEMO_SCENARIO_IDS.includes(requestedScenario as DemoScenarioId)
    ? (requestedScenario as DemoScenarioId)
    : 'connected';
  const requestedLocale = params.get('locale');
  const locale: DemoLocale = requestedLocale === 'zh-CN' ? requestedLocale : 'en';
  const requestedTime = params.get('time');
  const frozenTime =
    requestedTime && !Number.isNaN(Date.parse(requestedTime))
      ? new Date(requestedTime).toISOString()
      : DEFAULT_DEMO_TIME;
  return { scenarioId, locale, frozenTime };
}
