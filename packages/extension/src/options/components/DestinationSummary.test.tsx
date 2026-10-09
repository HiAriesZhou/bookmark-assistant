// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DestinationSummary } from './DestinationSummary';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', {
    i18n: {
      getMessage: (key: string) => key,
      getUILanguage: () => 'en',
    },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('uses an icon-only sync action and closes the overflow menu on outside click', async () => {
  await act(async () => {
    root.render(
      <DestinationSummary
        destination={{
          provider: { id: 'notion', displayName: 'Notion' },
          status: 'connected',
          workspaceName: 'Workspace',
        }}
        isBusy={false}
        onAction={() => undefined}
        onDisconnect={() => undefined}
      />
    );
  });

  const sync = container.querySelector<HTMLButtonElement>('[aria-label="destination_sync_action"]');
  expect(sync?.textContent).toBe('');

  const actions = container.querySelector<HTMLButtonElement>('[aria-label="destination_actions"]');
  await act(async () => actions?.click());
  expect(container.querySelector('[role="menu"]')).not.toBeNull();

  await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(container.querySelector('[role="menu"]')).toBeNull();
});

it('keeps the idle connect label as a layout reserve while connecting', async () => {
  await act(async () => {
    root.render(
      <DestinationSummary
        destination={{
          provider: { id: 'notion', displayName: 'Notion' },
          status: 'disconnected',
        }}
        isBusy
        onAction={() => undefined}
        onDisconnect={() => undefined}
      />
    );
  });

  const connect = container.querySelector<HTMLButtonElement>('[aria-label="connecting"]');
  expect(connect?.getAttribute('aria-busy')).toBe('true');
  expect(connect?.textContent).toContain('dashboard_action_connect');
});
