import { useState } from 'react';
import { createTranslator } from '../../utils/i18n';
import { isGoogleSignInAvailable } from '../../utils/account-state';
import { deleteServiceAccount, signInWithGoogleAccount, signOutAccount } from '../account-actions';
import { useToast } from '../hook/useToast';
import { useAppStore } from '../store';
import { ConfirmDialog } from './ConfirmDialog';
import { SettingsGroup, SettingsRow } from './Workspace';

const ACTION_BUTTON =
  'inline-flex h-9 items-center justify-center rounded-lg border border-ui-line bg-white px-3 text-sm font-medium text-ui-ink hover:border-ui-line-strong disabled:cursor-not-allowed disabled:opacity-50';

type PendingAction = 'sign-in' | 'sign-out' | 'delete' | null;

export function AccountSection() {
  const { t } = createTranslator();
  const { show } = useToast();
  const { isSignedIn, userEmail, hasGoogleSignIn, isConnected, refreshDashboard } = useAppStore();
  const [pending, setPending] = useState<PendingAction>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const googleAvailable = isGoogleSignInAvailable();

  const run = async (action: Exclude<PendingAction, null>, task: () => Promise<void>) => {
    setPending(action);
    try {
      await task();
      return true;
    } catch (error) {
      show({
        variant: 'error',
        title: t('error'),
        description: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      setPending(null);
    }
  };

  if (!isSignedIn) {
    return (
      <SettingsGroup id="account" title={t('account_title')}>
        <SettingsRow
          label={t('account_signed_out_label')}
          description={t(
            googleAvailable ? 'account_signed_out_desc' : 'account_signed_out_notion_only'
          )}
          controlAlign="end"
          control={
            googleAvailable ? (
              <button
                type="button"
                className={ACTION_BUTTON}
                disabled={pending !== null}
                onClick={() => void run('sign-in', signInWithGoogleAccount)}
              >
                {pending === 'sign-in' ? t('account_signing_in') : t('account_sign_in_google')}
              </button>
            ) : undefined
          }
        />
      </SettingsGroup>
    );
  }

  const methods = [
    hasGoogleSignIn ? t('account_method_google') : null,
    isConnected ? t('account_method_notion') : null,
  ].filter(Boolean);

  return (
    <SettingsGroup id="account" title={t('account_title')}>
      <SettingsRow
        label={userEmail || t('account_signed_in_label')}
        description={
          methods.length ? t('account_signed_in_with', [methods.join(' · ')]) : undefined
        }
        controlAlign="end"
        control={
          <div className="flex flex-wrap justify-end gap-2">
            {googleAvailable && !hasGoogleSignIn ? (
              <button
                type="button"
                className={ACTION_BUTTON}
                disabled={pending !== null}
                onClick={() => void run('sign-in', signInWithGoogleAccount)}
              >
                {t('account_link_google')}
              </button>
            ) : null}
            <button
              type="button"
              className={ACTION_BUTTON}
              disabled={pending !== null}
              onClick={() => void run('sign-out', () => signOutAccount(refreshDashboard))}
            >
              {t('account_sign_out')}
            </button>
          </div>
        }
      />
      <SettingsRow
        label={t('account_delete_label')}
        description={t('account_delete_desc')}
        controlAlign="end"
        control={
          <button
            type="button"
            className={`${ACTION_BUTTON} hover:border-ui-danger hover:text-ui-danger`}
            disabled={pending !== null}
            onClick={() => setConfirmDelete(true)}
          >
            {t('account_delete_action')}
          </button>
        }
      />
      <ConfirmDialog
        open={confirmDelete}
        title={t('account_delete_confirm_title')}
        description={t('account_delete_confirm_message')}
        confirmLabel={t('account_delete_action')}
        cancelLabel={t('action_cancel')}
        busy={pending === 'delete'}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          void run('delete', () => deleteServiceAccount(refreshDashboard)).then((deleted) => {
            if (deleted) setConfirmDelete(false);
          })
        }
      />
    </SettingsGroup>
  );
}
