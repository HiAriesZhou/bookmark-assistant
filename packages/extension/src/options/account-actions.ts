import { Messages, OAUTH_MESSAGE_TIMEOUT_MS, sendMessage } from '../utils/message';
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
    hasGoogleSignIn: false,
    showPriorNotionHint: false,
    lastSync: '',
    isSyncing: false,
    lastSyncSummary: undefined,
    autoSync: false,
    dashboard: undefined,
  });
  await refreshDashboard(false);
  await assertAccountContextCurrent(current);
}

function resetSignedOutView() {
  useAppStore.setState({
    isSignedIn: false,
    isConnected: false,
    isPro: false,
    plan: 'free',
    purchaseType: undefined,
    subscriptionSource: undefined,
    subscriptionExpiresAt: undefined,
    userId: '',
    userEmail: '',
    hasGoogleSignIn: false,
    showPriorNotionHint: false,
    lastSync: '',
    isSyncing: false,
    lastSyncSummary: undefined,
    autoSync: false,
    dashboard: undefined,
  });
}

function applySignedInView(result: {
  userEmail?: string;
  accountCreated?: boolean;
  fallbackEmail?: string;
}) {
  useAppStore.setState({
    isSignedIn: true,
    userEmail: result.userEmail || result.fallbackEmail || useAppStore.getState().userEmail,
    showPriorNotionHint: result.accountCreated === true,
  });
}

export async function startEmailSignIn(email: string, locale?: string) {
  const result = await sendMessage({ type: Messages.SIGN_IN_EMAIL_START, email, locale });
  if (!result.success) throw new Error(result.error || 'Failed to send sign-in code');
}

export async function verifyEmailSignIn(email: string, code: string) {
  const context = await readAccountContext();
  const result = await sendMessage({
    type: Messages.SIGN_IN_EMAIL_VERIFY,
    email,
    code,
    accountRevision: context.revision,
  });
  if (!result.success && !(await isAccountContextCurrent(context)))
    throw new StaleAccountStateError();
  if (!result.success) throw new Error(result.error || 'Failed to sign in');
  applySignedInView({ ...result, fallbackEmail: email });
}

export async function signInWithGoogleAccount() {
  const context = await readAccountContext();
  // The background waits for the user to finish Google's consent window.
  const result = await sendMessage(
    { type: Messages.SIGN_IN_GOOGLE, accountRevision: context.revision },
    { timeoutMs: OAUTH_MESSAGE_TIMEOUT_MS }
  );
  if (!result.success && !(await isAccountContextCurrent(context)))
    throw new StaleAccountStateError();
  if (!result.success) throw new Error(result.error || 'Failed to sign in with Google');
  applySignedInView(result);
}

export async function signOutAccount(refreshDashboard: (force: boolean) => Promise<void>) {
  const context = await readAccountContext();
  const result = await sendMessage({
    type: Messages.SIGN_OUT,
    accountRevision: context.revision,
  });
  if (!result.success && !(await isAccountContextCurrent(context)))
    throw new StaleAccountStateError();
  if (!result.success) throw new Error(result.error || 'Failed to sign out');
  const current = await readAccountContext();
  if (result.accountRevision && current.revision !== result.accountRevision)
    throw new StaleAccountStateError();
  if (current.token) throw new StaleAccountStateError();
  resetSignedOutView();
  await refreshDashboard(false);
  await assertAccountContextCurrent(current);
}
