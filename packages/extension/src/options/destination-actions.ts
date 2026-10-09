import { Messages, sendMessage } from '../utils/message';
import { useAppStore } from './store';

export async function disconnectNotionDestination(
  refreshDashboard: (force: boolean) => Promise<void>
) {
  await sendMessage({ type: Messages.LOGOUT });
  useAppStore.setState({
    isConnected: false,
    isPro: false,
    capabilities: undefined,
    plan: 'free',
    purchaseType: undefined,
    subscriptionSource: undefined,
    subscriptionExpiresAt: undefined,
    userId: '',
    userEmail: '',
    lastSync: '',
    isSyncing: false,
    lastSyncSummary: undefined,
    autoSync: false,
    dashboard: undefined,
  });
  await refreshDashboard(false);
}
