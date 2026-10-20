import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_PAGE_SAVE_MESSAGES,
  requestCurrentPageAi,
  requestCurrentPageSave,
  saveCurrentPageWithAi,
} from './save-current-page';

function stubMessages(replies: Record<string, unknown>) {
  const sendMessage = vi.fn(async (message: { type: string }) => {
    const reply = replies[message.type];
    if (reply instanceof Error) throw reply;
    return reply;
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  return sendMessage;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('requestCurrentPageSave', () => {
  it('uses a bounded channel for the base save acknowledgement', async () => {
    vi.useFakeTimers();
    let resolveResponse: (value: unknown) => void = () => undefined;
    const response = new Promise((resolve) => {
      resolveResponse = resolve;
    });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn(() => response) },
    });

    const pending = requestCurrentPageSave();
    await vi.advanceTimersByTimeAsync(119_000);
    resolveResponse({ success: true, aiStatus: 'not_started' });

    await expect(pending).resolves.toEqual({ success: true, aiStatus: 'not_started' });
  });

  it('keeps the separate AI channel alive for its bounded processing flow', async () => {
    vi.useFakeTimers();
    let resolveResponse: (value: unknown) => void = () => undefined;
    const response = new Promise((resolve) => {
      resolveResponse = resolve;
    });
    const sendMessage = vi.fn(() => response);
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const pending = requestCurrentPageAi('ai-request-1');
    await vi.advanceTimersByTimeAsync(210_000);
    resolveResponse({ success: true, aiStatus: 'succeeded' });

    await expect(pending).resolves.toEqual({ success: true, aiStatus: 'succeeded' });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'GENERATE_CURRENT_PAGE_AI',
      aiRequestId: 'ai-request-1',
    });
  });
});

describe('current-page save messages', () => {
  it.each(['en', 'zh_CN'])('are translated in %s', (locale) => {
    const catalog = JSON.parse(
      readFileSync(new URL(`../../_locales/${locale}/messages.json`, import.meta.url), 'utf8')
    ) as Record<string, { message?: string }>;
    for (const key of [...CURRENT_PAGE_SAVE_MESSAGES, 'saveCurrentPage', 'saveFailed']) {
      expect(catalog[key]?.message, `${locale}.${key}`).toBeTruthy();
    }
  });
});

describe('saveCurrentPageWithAi', () => {
  it.each([
    ['not_started', 'saveSuccess'],
    ['not_configured', 'saveSuccess'],
    ['skipped_ineligible_page', 'saveSuccess'],
    ['needs_attention', 'popup_ai_check_key'],
  ])('confirms a save without starting AI when it is %s', async (aiStatus, message) => {
    const sendMessage = stubMessages({ SAVE_CURRENT_PAGE: { success: true, aiStatus } });
    const onAiStarted = vi.fn();

    await expect(saveCurrentPageWithAi(onAiStarted)).resolves.toEqual({
      status: 'saved',
      message,
    });
    expect(onAiStarted).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['succeeded', 'popup_ai_succeeded'],
    ['skipped_insufficient_content', 'popup_ai_skipped'],
    ['skipped', 'popup_ai_skipped_page'],
    ['skipped_fetch_disallowed', 'popup_ai_skipped_page'],
    ['queued', 'popup_ai_processing'],
    ['processing', 'popup_ai_processing'],
    ['failed', 'popup_ai_failed'],
    ['needs_action', 'popup_ai_failed'],
    ['service_unavailable', 'popup_ai_failed'],
    ['paused', 'popup_ai_failed'],
    ['needs_attention', 'popup_ai_check_key'],
    ['not_configured', 'saveSuccess'],
    ['skipped_navigation_changed', 'popup_ai_not_started'],
    ['not_started', 'popup_ai_not_started'],
  ])('hands a pending save to AI and reports %s', async (aiStatus, message) => {
    const sendMessage = stubMessages({
      SAVE_CURRENT_PAGE: { success: true, aiStatus: 'pending', aiRequestId: 'request-1' },
      GENERATE_CURRENT_PAGE_AI: { success: true, aiStatus },
    });
    const onAiStarted = vi.fn();

    await expect(saveCurrentPageWithAi(onAiStarted)).resolves.toEqual({
      status: 'saved',
      message,
    });
    expect(onAiStarted).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'GENERATE_CURRENT_PAGE_AI',
      aiRequestId: 'request-1',
    });
  });

  it('keeps the save successful when the AI channel fails', async () => {
    stubMessages({
      SAVE_CURRENT_PAGE: { success: true, aiStatus: 'pending', aiRequestId: 'request-1' },
      GENERATE_CURRENT_PAGE_AI: new Error('Message timed out'),
    });

    await expect(saveCurrentPageWithAi(vi.fn())).resolves.toEqual({
      status: 'saved',
      message: 'popup_ai_not_started',
    });
  });

  it('reports a failed base save without starting AI', async () => {
    const sendMessage = stubMessages({
      SAVE_CURRENT_PAGE: { success: false, error: 'Cannot save internal page' },
    });

    await expect(saveCurrentPageWithAi(vi.fn())).resolves.toEqual({
      status: 'failed',
      error: 'Cannot save internal page',
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
