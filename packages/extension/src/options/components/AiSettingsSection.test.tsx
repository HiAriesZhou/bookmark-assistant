// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverAPI } from '../../background/server-api';
import { ToastProvider } from '../hook/ToastProvider';
import { useAppStore } from '../store';
import enMessages from '../../../_locales/en/messages.json';
import { AiSettingsSection } from './AiSettingsSection';

// Render real English copy so assertions cover the shipped messages and substitutions.
const englishMessages: Record<string, { message: string }> = enMessages;

function getEnglishMessage(key: string, substitutions?: string | string[]) {
  const values = Array.isArray(substitutions)
    ? substitutions
    : substitutions
      ? [substitutions]
      : [];
  return (englishMessages[key]?.message ?? '').replace(
    /\$(\d)/g,
    (_, index) => values[index - 1] ?? ''
  );
}

describe('AiSettingsSection', () => {
  const originalChrome = globalThis.chrome;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const originalState = useAppStore.getState();

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal('chrome', {
      ...originalChrome,
      i18n: { getMessage: getEnglishMessage, getUILanguage: () => 'en' },
    });
    useAppStore.setState({ ...originalState, isConnected: false });
    vi.spyOn(serverAPI, 'getAiSettings').mockResolvedValue({ settings: null });
    vi.spyOn(serverAPI, 'getAiCredential').mockResolvedValue({
      credential: null,
      providerModels: {
        openai: '',
        anthropic: '',
        gemini: '',
        deepseek: '',
        groq: '',
        minimax: '',
      },
    });
    vi.spyOn(serverAPI, 'getRecentAiProcessing').mockResolvedValue({ tasks: [] });
    vi.spyOn(serverAPI, 'getPendingAiSummary').mockResolvedValue({ pending: 0 });
    vi.spyOn(serverAPI, 'saveAiSettings').mockResolvedValue({ success: true });
    vi.spyOn(serverAPI, 'saveAiCredential').mockResolvedValue({
      credential: { provider: 'openai', keyLastFour: '1234', status: 'verified' },
    });
    vi.spyOn(serverAPI, 'deleteAiCredential').mockResolvedValue();
    vi.spyOn(serverAPI, 'runPendingAi').mockResolvedValue({
      processed: 0,
      remaining: 0,
      confirmedBatches: 0,
      succeeded: 0,
      skipped: 0,
      failed: 0,
      needsAction: 0,
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useAppStore.setState(originalState);
    vi.stubGlobal('chrome', originalChrome);
    vi.restoreAllMocks();
  });

  it('does not request protected AI data before a session exists', async () => {
    await act(async () => {
      root.render(
        <ToastProvider>
          <AiSettingsSection onUpgrade={() => undefined} />
        </ToastProvider>
      );
    });

    expect(serverAPI.getAiSettings).not.toHaveBeenCalled();
    expect(serverAPI.getAiCredential).not.toHaveBeenCalled();
    expect(serverAPI.getRecentAiProcessing).not.toHaveBeenCalled();
    expect(serverAPI.getPendingAiSummary).not.toHaveBeenCalled();

    await act(async () => {
      useAppStore.setState({ isConnected: true });
    });

    expect(serverAPI.getAiSettings).toHaveBeenCalledOnce();
    expect(serverAPI.getAiCredential).toHaveBeenCalledOnce();
    expect(serverAPI.getRecentAiProcessing).not.toHaveBeenCalled();
    expect(serverAPI.getPendingAiSummary).not.toHaveBeenCalled();
  });

  it('clears account-scoped AI state and disables controls after disconnecting', async () => {
    useAppStore.setState({ ...originalState, isConnected: true, isPro: true });
    vi.mocked(serverAPI.getAiSettings).mockResolvedValue({
      settings: {
        singlePageEnabled: false,
        batchEnabled: true,
      },
    });

    await act(async () => {
      root.render(
        <ToastProvider>
          <AiSettingsSection onUpgrade={() => undefined} />
        </ToastProvider>
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain('Advanced');
    expect(container.textContent).not.toContain('Excluded sites');

    await act(async () => {
      useAppStore.setState({ isConnected: false });
    });

    expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.disabled).toBe(
      true
    );
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Provider"]')?.disabled).toBe(
      true
    );
    expect(container.textContent).not.toContain('Save AI settings');
  });

  it('persists batch changes without the removed excluded-sites setting', async () => {
    useAppStore.setState({ ...originalState, isConnected: true, isPro: true });
    vi.mocked(serverAPI.getAiSettings).mockResolvedValue({
      settings: {
        singlePageEnabled: false,
        batchEnabled: false,
      },
    });

    await act(async () => {
      root.render(
        <ToastProvider>
          <AiSettingsSection onUpgrade={() => undefined} />
        </ToastProvider>
      );
      await Promise.resolve();
    });

    const batchSwitch = container.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(container.textContent).not.toContain('No pending items');
    await act(async () => {
      batchSwitch?.click();
      await Promise.resolve();
    });
    expect(serverAPI.saveAiSettings).toHaveBeenLastCalledWith({
      singlePageEnabled: true,
      batchEnabled: true,
    });
    expect(serverAPI.getPendingAiSummary).toHaveBeenCalledOnce();
  });

  it('waits for the explicit save action before verifying an API key', async () => {
    useAppStore.setState({ ...originalState, isConnected: true, isPro: true });

    await act(async () => {
      root.render(
        <ToastProvider>
          <AiSettingsSection onUpgrade={() => undefined} />
        </ToastProvider>
      );
      await Promise.resolve();
    });

    const apiKey = container.querySelector<HTMLInputElement>('input[type="password"]');
    await changeInput(apiKey, 'sk-test');

    expect(serverAPI.saveAiCredential).not.toHaveBeenCalled();

    const save = container.querySelector<HTMLButtonElement>(
      '[aria-label="Save and verify API key"]'
    );
    await act(async () => {
      save?.click();
      await Promise.resolve();
    });

    expect(serverAPI.saveAiCredential).toHaveBeenCalledWith('openai', 'sk-test');
    expect(serverAPI.saveAiSettings).toHaveBeenCalledWith({
      singlePageEnabled: true,
      batchEnabled: false,
    });
    expect(container.textContent).not.toContain('Generate for saved pages');
  });

  it('refreshes a stale task summary when returning after sync enrichment completes', async () => {
    useAppStore.setState({ ...originalState, isConnected: true, isPro: true });
    vi.mocked(serverAPI.getAiSettings).mockResolvedValue({
      settings: { singlePageEnabled: true, batchEnabled: true },
    });
    vi.mocked(serverAPI.getAiCredential).mockResolvedValue({
      credential: { provider: 'openai', keyLastFour: '1234', status: 'verified' },
      providerModels: providerModels({ openai: 'gpt-5-mini' }),
    });
    vi.mocked(serverAPI.getPendingAiSummary)
      .mockResolvedValueOnce({
        pending: 0,
        ready: 0,
        retryable: 0,
        scheduled: 0,
        processing: 0,
        blocked: 0,
      })
      .mockResolvedValueOnce({
        pending: 2,
        ready: 2,
        retryable: 0,
        scheduled: 0,
        processing: 0,
        blocked: 0,
      });

    await act(async () => {
      root.render(
        <ToastProvider>
          <AiSettingsSection active onUpgrade={() => undefined} />
        </ToastProvider>
      );
      await Promise.resolve();
    });
    expect(findButton(container, 'Generate')).toBeUndefined();

    await act(async () => {
      root.render(
        <ToastProvider>
          <AiSettingsSection active={false} onUpgrade={() => undefined} />
        </ToastProvider>
      );
      useAppStore.setState({
        syncEnrichment: {
          status: 'completed',
          total: 2,
          updatedAt: '2026-09-11T09:00:00.000Z',
        },
      });
      await Promise.resolve();
    });
    expect(serverAPI.getPendingAiSummary).toHaveBeenCalledOnce();

    await act(async () => {
      root.render(
        <ToastProvider>
          <AiSettingsSection active onUpgrade={() => undefined} />
        </ToastProvider>
      );
      await Promise.resolve();
    });
    expect(serverAPI.getPendingAiSummary).toHaveBeenCalledTimes(2);
    expect(findButton(container, 'Generate')).toBeDefined();
  });

  it('offers retry when recoverable tasks are the only remaining work', async () => {
    useAppStore.setState({ ...originalState, isConnected: true, isPro: true });
    vi.mocked(serverAPI.getAiSettings).mockResolvedValue({
      settings: { singlePageEnabled: true, batchEnabled: true },
    });
    vi.mocked(serverAPI.getAiCredential).mockResolvedValue({
      credential: { provider: 'openai', keyLastFour: '1234', status: 'verified' },
      providerModels: providerModels({ openai: 'gpt-5-mini' }),
    });
    vi.mocked(serverAPI.getPendingAiSummary).mockResolvedValue({
      pending: 2,
      ready: 0,
      retryable: 2,
      scheduled: 0,
      processing: 0,
      blocked: 0,
    });

    await act(async () => {
      root.render(
        <ToastProvider>
          <AiSettingsSection onUpgrade={() => undefined} />
        </ToastProvider>
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('2 items to retry');
    expect(findButton(container, 'Retry')).toBeDefined();
  });

  it('does not offer generation while queued tasks are waiting for their retry time', async () => {
    useAppStore.setState({ ...originalState, isConnected: true, isPro: true });
    vi.mocked(serverAPI.getAiSettings).mockResolvedValue({
      settings: { singlePageEnabled: true, batchEnabled: true },
    });
    vi.mocked(serverAPI.getAiCredential).mockResolvedValue({
      credential: { provider: 'openai', keyLastFour: '1234', status: 'verified' },
      providerModels: providerModels({ openai: 'gpt-5-mini' }),
    });
    vi.mocked(serverAPI.getPendingAiSummary).mockResolvedValue({
      pending: 0,
      ready: 0,
      retryable: 0,
      scheduled: 2,
      processing: 0,
      blocked: 0,
    });

    await act(async () => {
      root.render(
        <ToastProvider>
          <AiSettingsSection onUpgrade={() => undefined} />
        </ToastProvider>
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('2 items retry later');
    expect(findButton(container, 'Generate')).toBeUndefined();
    expect(findButton(container, 'Retry')).toBeUndefined();
  });

  it('disables generation while a replacement provider key is still a draft', async () => {
    useAppStore.setState({ ...originalState, isConnected: true, isPro: true });
    vi.mocked(serverAPI.getAiSettings).mockResolvedValue({
      settings: { singlePageEnabled: true, batchEnabled: true },
    });
    vi.mocked(serverAPI.getAiCredential).mockResolvedValue({
      credential: { provider: 'openai', keyLastFour: '1234', status: 'verified' },
      providerModels: providerModels({ openai: 'gpt-5-mini', deepseek: 'deepseek-chat' }),
    });
    vi.mocked(serverAPI.getPendingAiSummary).mockResolvedValue({
      pending: 2,
      ready: 2,
      retryable: 0,
      scheduled: 0,
      processing: 0,
      blocked: 0,
    });

    await act(async () => {
      root.render(
        <ToastProvider>
          <AiSettingsSection onUpgrade={() => undefined} />
        </ToastProvider>
      );
      await Promise.resolve();
    });
    expect(findButton(container, 'Generate')).toBeDefined();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Provider"]')?.click();
    });
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
        .find((option) => option.textContent?.includes('DeepSeek'))
        ?.click();
    });
    await changeInput(container.querySelector<HTMLInputElement>('input[type="password"]'), 'sk-x');

    expect(container.textContent).toContain('Save and verify your changes first');
    expect(container.textContent).toContain('Save and verify this key.');
    expect(container.textContent).not.toContain('Verified · ••••1234');
    expect(findButton(container, 'Generate')).toBeUndefined();
    expect(serverAPI.saveAiCredential).not.toHaveBeenCalled();
  });
});

async function changeInput(input: HTMLInputElement | null, value: string) {
  await act(async () => {
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

function findButton(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === label
  );
}

function providerModels(overrides: Partial<Record<string, string>> = {}) {
  return {
    openai: '',
    anthropic: '',
    gemini: '',
    deepseek: '',
    groq: '',
    minimax: '',
    ...overrides,
  };
}
