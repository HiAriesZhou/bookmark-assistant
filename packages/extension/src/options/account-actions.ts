import { Messages, sendMessage } from '../utils/message';
import { useAppStore } from './store';

/** Permanently deletes the server-side account, then resets this device to local mode. */
export async function deleteServiceAccount(refreshDashboard: (force: boolean) => Promise<void>) {
  const result = await sendMessage({ type: Messages.DELETE_ACCOUNT });
  if (!result.success) throw new Error(result.error || 'Failed to delete account');
  useAppStore.setState({
    isSignedIn: false,
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
