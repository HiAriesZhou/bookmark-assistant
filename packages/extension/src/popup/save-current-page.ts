import {
  GENERATE_CURRENT_PAGE_AI_MESSAGE_TIMEOUT_MS,
  Messages,
  SAVE_CURRENT_PAGE_MESSAGE_TIMEOUT_MS,
  sendMessage,
} from '../utils/message';

export type CurrentPageSaveOutcome =
  | { status: 'saved'; message: CurrentPageSaveMessage }
  | { status: 'failed'; error?: string };

type CurrentPageSaveMessage =
  | 'saveSuccess'
  | 'popup_ai_succeeded'
  | 'popup_ai_skipped'
  | 'popup_ai_not_started';

export function requestCurrentPageSave() {
  return sendMessage(
    { type: Messages.SAVE_CURRENT_PAGE },
    { timeoutMs: SAVE_CURRENT_PAGE_MESSAGE_TIMEOUT_MS }
  );
}

export function requestCurrentPageAi(aiRequestId: string) {
  return sendMessage(
    { type: Messages.GENERATE_CURRENT_PAGE_AI, aiRequestId },
    { timeoutMs: GENERATE_CURRENT_PAGE_AI_MESSAGE_TIMEOUT_MS }
  );
}

// AI that is not set up, or a page it may not read, is not a failure to report.
const AI_NOT_APPLICABLE = new Set(['not_configured', 'skipped_ineligible_page']);

function aiResultMessage(aiStatus: string | undefined): CurrentPageSaveMessage {
  if (aiStatus && AI_NOT_APPLICABLE.has(aiStatus)) return 'saveSuccess';
  if (aiStatus === 'succeeded') return 'popup_ai_succeeded';
  if (aiStatus === 'skipped_insufficient_content') return 'popup_ai_skipped';
  return 'popup_ai_not_started';
}

/**
 * Saves the active tab first, then asks the background to run AI only when it
 * stored an eligible handoff. The Notion save stays successful whatever AI does.
 */
export async function saveCurrentPageWithAi(
  onAiStarted: () => void
): Promise<CurrentPageSaveOutcome> {
  const saved = await requestCurrentPageSave();
  if (!saved?.success) return { status: 'failed', error: saved?.error };
  if (saved.aiStatus !== 'pending' || !saved.aiRequestId) {
    return { status: 'saved', message: 'saveSuccess' };
  }

  onAiStarted();
  try {
    const ai = await requestCurrentPageAi(saved.aiRequestId);
    return { status: 'saved', message: aiResultMessage(ai?.aiStatus) };
  } catch (error) {
    console.warn('[Popup] Current page AI did not complete:', error);
    return { status: 'saved', message: 'popup_ai_not_started' };
  }
}
