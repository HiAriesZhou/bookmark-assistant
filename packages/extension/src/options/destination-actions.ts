import { Messages, sendMessage } from '../utils/message';
import {
  readDestinationContext,
  isDestinationContextCurrent,
  StaleDestinationStateError,
} from '../utils/destination-state';
import { useAppStore } from './store';

/** Forgets the Notion token and database on this device. Pages already in Notion stay. */
export async function disconnectNotionDestination(
  refreshDashboard: (force: boolean) => Promise<void>
) {
  const context = await readDestinationContext();
  const result = await sendMessage({
    type: Messages.DISCONNECT_NOTION,
    destinationRevision: context.revision,
  });
  if (!result.success && !(await isDestinationContextCurrent(context)))
    throw new StaleDestinationStateError();
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
