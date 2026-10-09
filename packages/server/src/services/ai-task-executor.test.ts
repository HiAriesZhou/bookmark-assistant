import { describe, expect, it, vi } from 'vitest';
import { AiTaskExecutor } from './ai-task-executor';
import { createDescriptionBaselineHash } from './notion-ai-writer';
import { PublicPageFetchError } from './public-page-fetcher';
import { AiProviderGenerationError } from './ai-provider-adapters';

const task = {
  id: 'task-1', userId: 'user-1', knowledgeItemId: 'ki-1', notionPageId: 'page-1', sourceUrl: 'https://example.com/',
  mode: 'single_page' as const, status: 'processing' as const, provider: 'openai', model: 'gpt-5-mini', promptVersion: 'v1', credentialVersion: 1, leaseToken: 'lease-1',
};
const page = {
  id: 'page-1',
  properties: {
    Name: { id: 'title-id', type: 'title', title: [{ plain_text: 'Example title' }] },
    Description: { id: 'desc-id', type: 'rich_text', rich_text: [] },
    Tags: { id: 'tags-id', type: 'multi_select', multi_select: [{ name: 'Existing' }] },
  },
};

function createExecutor() {
  const store = { complete: vi.fn(async () => true), hasActiveLease: vi.fn(async () => true), stopUserTasksForProviderError: vi.fn(async () => undefined) };
  const notion = { getPage: vi.fn(async () => page), updatePage: vi.fn(async () => undefined) };
  const provider = { provider: 'openai' as const, model: 'gpt-5-mini', validateApiKey: vi.fn(), generate: vi.fn(async () => ({ text: '{"summary":"A concise summary.","tags":["AI"]}' })) };
  return {
    store, notion, provider,
    executor: new AiTaskExecutor({
      store,
      credentials: { getActiveCredential: async () => ({ provider: 'openai', apiKey: 'not-recorded', credentialVersion: 1 }) },
      notion,
      fetcher: { fetch: vi.fn() },
      providerFor: () => provider,
    }),
  };
}

describe('AiTaskExecutor', () => {
  it('generates from in-memory current page content and writes both properties once', async () => {
    const { executor, notion, provider, store } = createExecutor();
    await expect(executor.execute(task, { accessToken: 'not-recorded', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'Useful page body '.repeat(30) })).resolves.toBe('succeeded');
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(notion.updatePage).toHaveBeenCalledWith('page-1', expect.objectContaining({ 'desc-id': expect.anything(), 'tags-id': expect.anything() }), 'not-recorded');
    expect(store.complete).toHaveBeenLastCalledWith('task-1', 'lease-1', 'succeeded', undefined);
  });

  it('does not call the provider after a credential version changes', async () => {
    const { executor, provider, store } = createExecutor();
    await expect(executor.execute({ ...task, credentialVersion: 2 }, { accessToken: 'token', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'body' })).resolves.toBe('needs_action');
    expect(provider.generate).not.toHaveBeenCalled();
    expect(store.complete).toHaveBeenLastCalledWith('task-1', 'lease-1', 'needs_action', 'needs_action_credential_deleted');
  });

  it('records a provider request failure without treating it as a Notion failure', async () => {
    const { executor, notion, provider, store } = createExecutor();
    provider.generate.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(executor.execute(task, { accessToken: 'token', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'useful page content '.repeat(45) })).resolves.toBe('failed');

    expect(notion.updatePage).not.toHaveBeenCalled();
    expect(store.complete).toHaveBeenLastCalledWith('task-1', 'lease-1', 'failed', 'failed_provider_request');
  });

  it('pauses all matching tasks when the provider rejects the saved key', async () => {
    const { executor, provider, store } = createExecutor();
    provider.generate.mockRejectedValueOnce(new AiProviderGenerationError('invalid_api_key', 'openai'));
    await expect(executor.execute(task, { accessToken: 'token', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'useful page content '.repeat(45) })).resolves.toBe('needs_action');
    expect(store.stopUserTasksForProviderError).toHaveBeenCalledWith('user-1', 'openai', 1, 'needs_action_invalid_api_key');
  });

  it('does not retry malformed model output as a provider request', async () => {
    const { executor, notion, provider, store } = createExecutor();
    provider.generate.mockResolvedValueOnce({ text: 'not valid structured output' });

    await expect(executor.execute(task, { accessToken: 'token', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'useful page content '.repeat(45) })).resolves.toBe('failed');

    expect(notion.updatePage).not.toHaveBeenCalled();
    expect(store.complete).toHaveBeenLastCalledWith('task-1', 'lease-1', 'failed', 'failed_invalid_output');
  });

  it('compresses an overlong summary once before writing', async () => {
    const { executor, notion, provider } = createExecutor();
    provider.generate
      .mockResolvedValueOnce({ text: JSON.stringify({ summary: 'word '.repeat(61), tags: ['AI'] }) })
      .mockResolvedValueOnce({ text: '{"summary":"A concise summary.","tags":["AI"]}' });

    await expect(executor.execute(task, {
      accessToken: 'token',
      settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' },
      currentPageBody: 'useful page content '.repeat(45),
    })).resolves.toBe('succeeded');

    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(notion.updatePage).toHaveBeenCalledTimes(1);
  });

  it('records a Notion update error separately from provider errors', async () => {
    const { executor, notion, store } = createExecutor();
    notion.updatePage.mockRejectedValue(new Error('Notion unavailable'));

    await expect(executor.execute(task, { accessToken: 'token', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'useful page content '.repeat(45) })).resolves.toBe('failed');

    expect(store.complete).toHaveBeenLastCalledWith('task-1', 'lease-1', 'failed', 'failed_notion_write');
  });

  it('skips a page under an archived Notion ancestor instead of retrying it', async () => {
    const { executor, notion, store } = createExecutor();
    notion.updatePage.mockRejectedValue({
      code: 'validation_error',
      status: 400,
      message: "Can't edit page on block with an archived ancestor.",
    });

    await expect(executor.execute(task, { accessToken: 'token', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'useful page content '.repeat(45) })).resolves.toBe('skipped');

    expect(notion.updatePage).toHaveBeenCalledTimes(1);
    expect(store.complete).toHaveBeenLastCalledWith('task-1', 'lease-1', 'skipped', 'skipped_target_unavailable');
  });

  it('treats a missing Notion update capability as an authorization action', async () => {
    const { executor, notion, store } = createExecutor();
    notion.updatePage.mockRejectedValue({ code: 'restricted_resource', status: 403 });

    await expect(executor.execute(task, { accessToken: 'token', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'useful page content '.repeat(45) })).resolves.toBe('needs_action');

    expect(notion.updatePage).toHaveBeenCalledTimes(1);
    expect(store.complete).toHaveBeenLastCalledWith('task-1', 'lease-1', 'needs_action', 'needs_action_notion_authorization');
  });

  it('retries a Notion update once after an ambiguous failure without calling AI again', async () => {
    const { executor, notion, provider } = createExecutor();
    notion.updatePage.mockRejectedValueOnce(new Error('connection closed'));
    await expect(executor.execute(task, { accessToken: 'token', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'useful page content '.repeat(45) })).resolves.toBe('succeeded');
    expect(notion.updatePage).toHaveBeenCalledTimes(2);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('accepts an ambiguous Notion response when the refreshed page contains the output', async () => {
    const { executor, notion } = createExecutor();
    notion.updatePage.mockRejectedValueOnce(new Error('connection closed'));
    notion.getPage.mockResolvedValueOnce(page).mockResolvedValueOnce(page).mockResolvedValueOnce({
      ...page,
      properties: {
        ...page.properties,
        Description: { id: 'desc-id', type: 'rich_text', rich_text: [{ plain_text: 'A concise summary.' }] },
        Tags: { id: 'tags-id', type: 'multi_select', multi_select: [{ name: 'Existing' }, { name: 'AI' }] },
      },
    });
    await expect(executor.execute(task, { accessToken: 'token', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'useful page content '.repeat(45) })).resolves.toBe('succeeded');
    expect(notion.updatePage).toHaveBeenCalledTimes(1);
  });

  it('retries an ambiguous Notion write with tags only after detecting a user edit', async () => {
    const { executor, notion } = createExecutor();
    notion.updatePage.mockRejectedValueOnce(new Error('connection closed'));
    notion.getPage.mockResolvedValueOnce(page).mockResolvedValueOnce(page).mockResolvedValueOnce({
      ...page,
      properties: { ...page.properties, Description: { id: 'desc-id', type: 'rich_text', rich_text: [{ plain_text: 'My edit wins' }] } },
    });
    await expect(executor.execute(task, { accessToken: 'token', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'useful page content '.repeat(45) })).resolves.toBe('succeeded');
    expect(notion.updatePage).toHaveBeenCalledTimes(2);
    expect(notion.updatePage).toHaveBeenLastCalledWith(
      'page-1',
      { 'tags-id': { multi_select: [{ name: 'Existing' }, { name: 'AI' }] } },
      'token'
    );
  });

  it('skips content that is too thin before calling the provider', async () => {
    const { executor, notion, provider, store } = createExecutor();
    notion.getPage.mockResolvedValue({
      ...page,
      properties: {
        ...page.properties,
        Name: { id: 'title-id', type: 'title', title: [{ plain_text: 'Home' }] },
      },
    });
    await expect(executor.execute(task, { accessToken: 'token', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'Sign in' })).resolves.toBe('skipped');
    expect(provider.generate).not.toHaveBeenCalled();
    expect(store.complete).toHaveBeenLastCalledWith('task-1', 'lease-1', 'skipped', 'skipped_insufficient_content');
  });

  it('uses existing Notion tag options as vocabulary and preserves their casing', async () => {
    const { store, notion, provider } = createExecutor();
    const getAiTagCandidates = vi.fn(async () => ['Artificial Intelligence']);
    provider.generate.mockResolvedValueOnce({ text: '{"summary":"A concise summary.","tags":["artificial intelligence"]}' });
    const executor = new AiTaskExecutor({
      store,
      credentials: { getActiveCredential: async () => ({ provider: 'openai', apiKey: 'not-recorded', credentialVersion: 1 }) },
      notion: { ...notion, getAiTagCandidates }, fetcher: { fetch: vi.fn() }, providerFor: () => provider,
    });
    await expect(executor.execute(task, { accessToken: 'token', dataSourceId: 'source-1', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'useful page content '.repeat(45) })).resolves.toBe('succeeded');
    expect(getAiTagCandidates).toHaveBeenCalledWith('source-1', 'token', 'tags-id');
    expect(notion.updatePage).toHaveBeenCalledWith('page-1', expect.objectContaining({ 'tags-id': { multi_select: [{ name: 'Existing' }, { name: 'Artificial Intelligence' }] } }), 'token');
  });

  it('marks an inaccessible Notion page as needing authorization', async () => {
    const { executor, notion, provider, store } = createExecutor();
    notion.getPage.mockRejectedValueOnce(new Error('unauthorized'));

    await expect(executor.execute(task, { accessToken: 'token', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'body' })).resolves.toBe('needs_action');

    expect(provider.generate).not.toHaveBeenCalled();
    expect(store.complete).toHaveBeenLastCalledWith('task-1', 'lease-1', 'needs_action', 'needs_action_notion_authorization');
  });

  it('uses the saved Notion description when a batch page cannot be fetched', async () => {
    const { executor, notion, provider, store } = createExecutor();
    const pageWithDescription = {
      ...page,
      properties: {
        ...page.properties,
        Description: {
          id: 'desc-id',
          type: 'rich_text',
          rich_text: [{ plain_text: 'A useful page description with enough factual context for accurate AI bookmark summary and topic tag generation.' }],
        },
      },
    };
    notion.getPage.mockResolvedValue(pageWithDescription);

    await expect(
      executor.execute(
        {
          ...task,
          mode: 'batch',
          descriptionBaselineHash: createDescriptionBaselineHash(
            'A useful page description with enough factual context for accurate AI bookmark summary and topic tag generation.'
          ),
        },
        { accessToken: 'not-recorded', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' } }
      )
    ).resolves.toBe('succeeded');

    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(store.complete).toHaveBeenLastCalledWith('task-1', 'lease-1', 'succeeded', undefined);
  });

  it('does not overwrite a description edited while the provider is running, but writes tags', async () => {
    const { executor, notion, provider } = createExecutor();
    notion.getPage
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce({
        ...page,
        properties: {
          ...page.properties,
          Description: { id: 'desc-id', type: 'rich_text', rich_text: [{ plain_text: 'My edited description' }] },
        },
      });

    await expect(executor.execute(task, { accessToken: 'token', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'useful page content '.repeat(45) })).resolves.toBe('succeeded');
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(notion.updatePage).toHaveBeenCalledWith(
      'page-1',
      { 'tags-id': { multi_select: [{ name: 'Existing' }, { name: 'AI' }] } },
      'token'
    );
  });

  it('does not write after losing its lease', async () => {
    const { executor, notion, store } = createExecutor();
    store.hasActiveLease.mockResolvedValueOnce(false);
    await expect(executor.execute(task, { accessToken: 'token', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' }, currentPageBody: 'useful page content '.repeat(45) })).resolves.toBe('paused');
    expect(notion.updatePage).not.toHaveBeenCalled();
  });

  it('does not fetch or send content from a disallowed source', async () => {
    const { executor, notion, provider, store } = createExecutor();
    await expect(executor.execute({ ...task, sourceUrl: 'http://localhost/private' }, {
      accessToken: 'token',
      settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' },
      currentPageBody: 'private body',
    })).resolves.toBe('skipped');
    expect(notion.getPage).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
    expect(store.complete).toHaveBeenLastCalledWith('task-1', 'lease-1', 'skipped', 'skipped_fetch_disallowed');
  });

  it('skips a page from a previously connected data source before calling AI', async () => {
    const { executor, notion, provider, store } = createExecutor();
    notion.getPage.mockResolvedValue({
      ...page,
      parent: { type: 'data_source_id', data_source_id: 'old-source' },
    });

    await expect(executor.execute(task, {
      accessToken: 'token',
      dataSourceId: 'current-source',
      settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' },
      currentPageBody: 'useful page content '.repeat(45),
    })).resolves.toBe('skipped');

    expect(provider.generate).not.toHaveBeenCalled();
    expect(store.complete).toHaveBeenLastCalledWith('task-1', 'lease-1', 'skipped', 'skipped_target_unavailable');
  });

  it('uses Notion metadata without sending rejected public-page content', async () => {
    const { executor, notion, provider, store } = createExecutor();
    notion.getPage.mockResolvedValue({
      ...page,
      properties: {
        ...page.properties,
        Description: { id: 'desc-id', type: 'rich_text', rich_text: [{ plain_text: 'This public metadata description contains enough factual words to generate a useful summary and several accurate topic tags.' }] },
      },
    });
    const fetchPage = vi.fn(async () => { throw new PublicPageFetchError('fetch_disallowed'); });
    const guarded = new AiTaskExecutor({
      store,
      credentials: { getActiveCredential: async () => ({ provider: 'openai', apiKey: 'not-recorded', credentialVersion: 1 }) },
      notion,
      fetcher: { fetch: fetchPage },
      providerFor: () => provider,
    });
    await expect(guarded.execute({ ...task, mode: 'batch' }, { accessToken: 'token', settings: { descriptionPropertyId: 'desc-id', tagsPropertyId: 'tags-id' } })).resolves.toBe('succeeded');
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(provider.generate).toHaveBeenCalledWith(
      'not-recorded',
      expect.stringContaining('This public metadata description contains enough factual words')
    );
    expect(store.complete).toHaveBeenLastCalledWith('task-1', 'lease-1', 'succeeded', undefined);
  });
});
