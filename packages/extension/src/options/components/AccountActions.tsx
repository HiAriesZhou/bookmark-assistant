import { isStaleAccountStateError } from '../../utils/account-state';
import { useState } from 'react';
import { createTranslator } from '../../utils/i18n';
import { deleteServiceAccount, signOutAccount } from '../account-actions';
import { useToast } from '../hook/useToast';
import { useAppStore } from '../store';
import { ConfirmDialog } from './ConfirmDialog';
import { useAccountAction } from '../hook/useAccountAction';

/**
 * Bottom of the signed-in settings page: sign out, and the explicit deletion of the
 * server-side account. Disconnecting Notion keeps the account; the dialog explains deletion.
 */
export function AccountActions() {
  const { t } = createTranslator();
  const { show } = useToast();
  const { isSignedIn, refreshDashboard } = useAppStore();
  const { busy: signingOut, run } = useAccountAction();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!isSignedIn) return null;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteServiceAccount(refreshDashboard);
      setConfirmOpen(false);
      show({ variant: 'success', title: t('service_data_deleted_title') });
    } catch (error) {
      if (isStaleAccountStateError(error)) return;
      show({
        variant: 'error',
        title: t('error'),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section
      id="account-actions"
      aria-label={t('account_title')}
      className="flex items-center justify-between gap-3 px-1"
    >
      <button
        type="button"
        className="inline-flex h-9 items-center justify-center rounded-lg border border-ui-line bg-white px-3 text-sm font-medium text-ui-ink transition-transform hover:border-ui-ink active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={signingOut || deleting}
        onClick={() => void run(() => signOutAccount(refreshDashboard))}
      >
        {t('account_sign_out')}
      </button>
      <button
        type="button"
        className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-medium text-ui-subtle transition-transform hover:text-ui-danger active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={signingOut || deleting}
        onClick={() => setConfirmOpen(true)}
      >
        {t('service_data_delete_action')}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title={t('service_data_delete_confirm_title')}
        description={t('service_data_delete_confirm_message')}
        confirmLabel={t('service_data_delete_action')}
        cancelLabel={t('action_cancel')}
        busy={deleting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void handleDelete()}
      />
    </section>
  );
}
