import { Messages, sendMessage } from '../utils/message';
import { useAppStore } from './store';

/** Removes the Notion destination. The account stays signed in with its plan. */
export async function disconnectNotionDestination(
  refreshDashboard: (force: boolean) => Promise<void>
) {
  const result = await sendMessage({ type: Messages.DISCONNECT_NOTION });
  if (!result.success) throw new Error(result.error || 'Failed to disconnect Notion');
  useAppStore.setState({
    isConnected: false,
    lastSync: '',
    isSyncing: false,
    lastSyncSummary: undefined,
    autoSync: false,
    dashboard: undefined,
  });
  await refreshDashboard(false);
}
