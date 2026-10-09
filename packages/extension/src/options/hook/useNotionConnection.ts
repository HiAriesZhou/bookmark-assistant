import { createTranslator } from '../../utils/i18n';
import { Messages, OAUTH_MESSAGE_TIMEOUT_MS, sendMessage } from '../../utils/message';
import { useAppStore } from '../store';
import { useToast } from './useToast';

export function useNotionConnection() {
  const { t } = createTranslator();
  const { show } = useToast();
  const isConnecting = useAppStore((state) => state.isConnecting);

  const connect = async (): Promise<boolean> => {
    try {
      const response = await sendMessage(
        { type: Messages.NOTION_OAUTH },
        { timeoutMs: OAUTH_MESSAGE_TIMEOUT_MS }
      );

      if (response.success) {
        show({
          variant: 'success',
          title: t('connected'),
          description: t('connection_success_desc'),
        });
        return true;
      }

      show({
        variant: 'error',
        title: t('connection_failed_title'),
        description: response.error || t('connection_failed_desc'),
      });
    } catch (error) {
      show({
        variant: 'error',
        title: t('connection_failed_title'),
        description: error instanceof Error ? error.message : t('connection_error_desc'),
      });
    }

    return false;
  };

  return { connect, isConnecting };
}
