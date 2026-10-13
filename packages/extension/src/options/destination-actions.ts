import { Messages, sendMessage } from '../utils/message';
import {
  readAccountContext,
  isAccountContextCurrent,
  assertAccountContextCurrent,
  StaleAccountStateError,
} from '../utils/account-state';
import { useAppStore } from './store';

/** Removes the Notion destination. The account stays signed in with its plan. */
export async function disconnectNotionDestination(
  refreshDashboard: (force: boolean) => Promise<void>
) {
  const context = await readAccountContext();
  const result = await sendMessage({
    type: Messages.DISCONNECT_NOTION,
    accountRevision: context.revision,
  });
  if (!result.success && !(await isAccountContextCurrent(context)))
    throw new StaleAccountStateError();
  if (!result.success) throw new Error(result.error || 'Failed to disconnect Notion');
  const current = await readAccountContext();
  if (result.accountRevision && current.revision !== result.accountRevision)
    throw new StaleAccountStateError();
  useAppStore.setState({
    isConnected: false,
    lastSync: '',
    isSyncing: false,
    lastSyncSummary: undefined,
    autoSync: false,
    dashboard: undefined,
  });
  await refreshDashboard(false);
  await assertAccountContextCurrent(current);
}
