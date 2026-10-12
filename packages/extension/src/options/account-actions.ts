import { Messages, sendMessage } from '../utils/message';
import { useAppStore } from './store';

const SIGNED_OUT_STATE = {
  isSignedIn: false,
  hasGoogleSignIn: false,
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
} as const;

export async function signInWithGoogleAccount(): Promise<void> {
  // Google's account chooser can take a while; the background owns the timeout.
  const result = await sendMessage({ type: Messages.GOOGLE_SIGN_IN }, { timeoutMs: 0 });
  if (!result.success) throw new Error(result.error || 'Google sign-in failed');
  await useAppStore.getState().refreshEntitlements(true);
}

/** Signs out on this device; the account, plan and Notion link stay on the server. */
export async function signOutAccount(refreshDashboard: (force: boolean) => Promise<void>) {
  await sendMessage({ type: Messages.LOGOUT });
  useAppStore.setState(SIGNED_OUT_STATE);
  await refreshDashboard(false);
}

export async function deleteServiceAccount(refreshDashboard: (force: boolean) => Promise<void>) {
  const result = await sendMessage({ type: Messages.DELETE_ACCOUNT });
  if (!result.success) throw new Error(result.error || 'Failed to delete account');
  useAppStore.setState(SIGNED_OUT_STATE);
  await refreshDashboard(false);
}
