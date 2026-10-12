import { useState } from 'react';
import { createTranslator } from '../../utils/i18n';
import { deleteServiceAccount } from '../account-actions';
import { useToast } from '../hook/useToast';
import { useAppStore } from '../store';
import { ConfirmDialog } from './ConfirmDialog';
import { SettingsGroup, SettingsRow } from './Workspace';

/** Explicit deletion of the server-side account; disconnecting Notion keeps it. */
export function ServiceDataSection() {
  const { t } = createTranslator();
  const { show } = useToast();
  const { isSignedIn, userEmail, refreshDashboard } = useAppStore();
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
    <SettingsGroup id="service-data" title={t('service_data_title')}>
      <SettingsRow
        label={t('service_data_delete_label')}
        description={
          userEmail
            ? t('service_data_delete_desc_with_email', [userEmail])
            : t('service_data_delete_desc')
        }
        controlAlign="end"
        control={
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-ui-line bg-white px-3 text-sm font-medium text-ui-ink hover:border-ui-danger hover:text-ui-danger disabled:cursor-not-allowed disabled:opacity-50"
            disabled={deleting}
            onClick={() => setConfirmOpen(true)}
          >
            {t('service_data_delete_action')}
          </button>
        }
      />
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
    </SettingsGroup>
  );
}
