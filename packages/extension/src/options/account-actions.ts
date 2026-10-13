import { Messages, sendMessage } from '../utils/message';
import {
  readAccountContext,
  isAccountContextCurrent,
  assertAccountContextCurrent,
  StaleAccountStateError,
} from '../utils/account-state';
import { useAppStore } from './store';

/** Permanently deletes the server-side account, then resets this device to local mode. */
export async function deleteServiceAccount(refreshDashboard: (force: boolean) => Promise<void>) {
  const context = await readAccountContext();
  const result = await sendMessage({
    type: Messages.DELETE_ACCOUNT,
    accountRevision: context.revision,
  });
  if (!result.success && !(await isAccountContextCurrent(context)))
    throw new StaleAccountStateError();
  if (!result.success) throw new Error(result.error || 'Failed to delete account');
  const current = await readAccountContext();
  if (result.accountRevision && current.revision !== result.accountRevision)
    throw new StaleAccountStateError();
  if (current.token) throw new StaleAccountStateError();
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
  await assertAccountContextCurrent(current);
}
