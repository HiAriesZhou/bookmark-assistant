import { describe, expect, it } from 'vitest';
import { AiProviderControlService } from './ai-provider-control-service';

describe('AiProviderControlService', () => {
  it('allows providers without an override row', async () => {
    const service = new AiProviderControlService({ get: async () => undefined });
    await expect(service.isAllowed('openai', 'batch')).resolves.toBe(true);
  });

  it('enforces global and mode-specific pauses', async () => {
    const globallyPaused = new AiProviderControlService({
      get: async () => ({ status: 'paused', singlePageEnabled: true, batchEnabled: true }),
    });
    await expect(globallyPaused.isAllowed('openai', 'validation')).resolves.toBe(false);
    const batchPaused = new AiProviderControlService({
      get: async () => ({ status: 'enabled', singlePageEnabled: true, batchEnabled: false }),
    });
    await expect(batchPaused.isAllowed('openai', 'batch')).resolves.toBe(false);
    await expect(batchPaused.isAllowed('openai', 'single_page')).resolves.toBe(true);
  });
});
