import {
  GENERATE_CURRENT_PAGE_AI_MESSAGE_TIMEOUT_MS,
  Messages,
  SAVE_CURRENT_PAGE_MESSAGE_TIMEOUT_MS,
  sendMessage,
  type CurrentPageAiStatus,
} from '../utils/message';

export type CurrentPageSaveOutcome =
  | { status: 'saved'; message: CurrentPageSaveMessage }
  | { status: 'failed'; error?: string };

// Shown through a lookup, so scripts/check-i18n.js cannot see them; the tests
// check that every locale translates each one.
export const CURRENT_PAGE_SAVE_MESSAGES = [
  'saveSuccess',
  'popup_ai_succeeded',
  'popup_ai_skipped',
  'popup_ai_skipped_page',
  'popup_ai_processing',
  'popup_ai_failed',
  'popup_ai_check_key',
  'popup_ai_not_started',
] as const;

export type CurrentPageSaveMessage = (typeof CURRENT_PAGE_SAVE_MESSAGES)[number];

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

// Exhaustive so a new status cannot fall through to a misleading message. AI
// that is not set up, or a page it may not read, is not a failure to report.
const AI_RESULT_MESSAGES: Record<CurrentPageAiStatus, CurrentPageSaveMessage> = {
  not_configured: 'saveSuccess',
  skipped_ineligible_page: 'saveSuccess',
  needs_attention: 'popup_ai_check_key',
  succeeded: 'popup_ai_succeeded',
  skipped_insufficient_content: 'popup_ai_skipped',
  skipped: 'popup_ai_skipped_page',
  skipped_fetch_disallowed: 'popup_ai_skipped_page',
  awaiting_confirmation: 'popup_ai_processing',
  queued: 'popup_ai_processing',
  processing: 'popup_ai_processing',
  failed: 'popup_ai_failed',
  needs_action: 'popup_ai_failed',
  service_unavailable: 'popup_ai_failed',
  paused: 'popup_ai_failed',
  skipped_navigation_changed: 'popup_ai_not_started',
  not_started: 'popup_ai_not_started',
};

function aiResultMessage(aiStatus: CurrentPageAiStatus | undefined): CurrentPageSaveMessage {
  return (aiStatus && AI_RESULT_MESSAGES[aiStatus]) || 'popup_ai_not_started';
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
    // Without a handoff only a key that needs attention is worth mentioning.
    const message = saved.aiStatus === 'needs_attention' ? 'popup_ai_check_key' : 'saveSuccess';
    return { status: 'saved', message };
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
