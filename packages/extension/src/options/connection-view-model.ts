import type { DashboardConnectionStatus } from '../dashboard/types';

/**
 * OAuth session state is the primary connection signal shared by Popup and Options.
 * A transient/degraded health check must not turn an existing session into a reconnect prompt.
 */
export function deriveConnectionStatus(
  hasActiveSession: boolean,
  dashboardStatus: DashboardConnectionStatus = 'checking',
  hasHydratedSession = true
): DashboardConnectionStatus {
  if (!hasHydratedSession) return 'checking';
  if (!hasActiveSession) return 'disconnected';
  if (dashboardStatus === 'disconnected') return 'disconnected';
  return 'connected';
}

export function showsSyncStatus(status: DashboardConnectionStatus): boolean {
  return status === 'connected' || status === 'degraded';
}
