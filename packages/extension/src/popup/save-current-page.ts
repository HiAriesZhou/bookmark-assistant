import {
  GENERATE_CURRENT_PAGE_AI_MESSAGE_TIMEOUT_MS,
  Messages,
  SAVE_CURRENT_PAGE_MESSAGE_TIMEOUT_MS,
  sendMessage,
} from '../utils/message';

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
