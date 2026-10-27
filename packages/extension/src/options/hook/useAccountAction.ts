import { useState } from 'react';
import { isStaleAccountStateError } from '../../utils/account-state';
import { createTranslator } from '../../utils/i18n';
import { useToast } from './useToast';

/** Runs an account action with a busy flag and an error toast; stale replies stay silent. */
export function useAccountAction() {
  const { t } = createTranslator();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (isStaleAccountStateError(error)) return;
      show({
        variant: 'error',
        title: t('error'),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}
