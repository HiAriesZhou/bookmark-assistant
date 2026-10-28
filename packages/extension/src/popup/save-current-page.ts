import { Messages, SAVE_CURRENT_PAGE_MESSAGE_TIMEOUT_MS, sendMessage } from '../utils/message';

export type CurrentPageSaveOutcome = { status: 'saved' } | { status: 'failed'; error?: string };

/** Saves the active tab to the connected Notion database. */
export async function saveCurrentPage(): Promise<CurrentPageSaveOutcome> {
  try {
    const saved = await sendMessage(
      { type: Messages.SAVE_CURRENT_PAGE },
      { timeoutMs: SAVE_CURRENT_PAGE_MESSAGE_TIMEOUT_MS }
    );
    return saved?.success ? { status: 'saved' } : { status: 'failed', error: saved?.error };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}
