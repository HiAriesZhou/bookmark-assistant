import type { DashboardConnectionStatus, DashboardSnapshot } from '../dashboard/types';

export interface DestinationSummaryModel {
  provider: {
    id: string;
    displayName: string;
  };
  status: DashboardConnectionStatus;
  workspaceName?: string;
  destinationName?: string;
  lastSyncAt?: string;
}

const DEFAULT_PROVIDER = {
  id: 'notion',
  displayName: 'Notion',
} as const;

/**
 * Keeps provider-specific dashboard fields behind a destination-shaped view model.
 * Future providers can populate the same contract without changing the Options layout.
 */
export function createDestinationSummary(
  dashboard: DashboardSnapshot | undefined,
  status: DashboardConnectionStatus
): DestinationSummaryModel {
  return {
    provider: dashboard?.connection.provider ?? DEFAULT_PROVIDER,
    status,
    workspaceName: dashboard?.connection.workspaceName,
    destinationName: dashboard?.connection.databaseName,
    lastSyncAt: dashboard?.sync.lastSyncAt,
  };
}
