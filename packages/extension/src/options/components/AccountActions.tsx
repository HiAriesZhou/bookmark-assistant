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
  const { isSignedIn, userEmail, refreshDashboard } = useAppStore();
  const { busy: signingOut, run } = useAccountAction();
  const { busy: deleting, run: runDelete } = useAccountAction();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!isSignedIn) return null;

  const handleDelete = () =>
    runDelete(async () => {
      await deleteServiceAccount(refreshDashboard);
      setConfirmOpen(false);
      show({ variant: 'success', title: t('service_data_deleted_title') });
    });
  // Deletion cannot be undone, so the dialog names the account it removes.
  const deleteMessage = userEmail
    ? `${t('service_data_delete_confirm_account', [userEmail])} ${t('service_data_delete_confirm_message')}`
    : t('service_data_delete_confirm_message');

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
        description={deleteMessage}
        confirmLabel={t('service_data_delete_action')}
        cancelLabel={t('action_cancel')}
        busy={deleting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void handleDelete()}
      />
    </section>
  );
}
