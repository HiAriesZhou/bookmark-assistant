import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const notionMocks = vi.hoisted(() => ({
  blocksChildrenList: vi.fn(),
  request: vi.fn(),
  Client: vi.fn(),
}));

vi.mock('@notionhq/client', () => ({
  Client: notionMocks.Client,
}));

import { NotionService } from './notion';

describe('NotionService template resolution', () => {
  beforeEach(() => {
    notionMocks.blocksChildrenList.mockReset();
    notionMocks.request.mockReset();
    notionMocks.Client.mockReset();
    notionMocks.Client.mockImplementation(function (this: any) {
      this.blocks = {
        children: {
          list: notionMocks.blocksChildrenList,
        },
      };
      this.request = notionMocks.request;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for Notion template copying to finish before resolving the duplicated database', async () => {
    vi.useFakeTimers();

    const copyIndicatorError = Object.assign(
      new Error('Block type copy_indicator is not supported via the API.'),
      { code: 'validation_error' }
    );

    notionMocks.blocksChildrenList.mockRejectedValueOnce(copyIndicatorError).mockResolvedValueOnce({
      has_more: false,
      results: [
        {
          id: 'database-block-id',
          type: 'child_database',
        },
      ],
    });
    notionMocks.request.mockResolvedValue({
      object: 'database',
      id: 'database-block-id',
      is_inline: true,
      data_sources: [{ id: 'data-source-id' }],
    });

    const service = new NotionService();
    const result = service.resolveDatabaseFromTemplate('duplicated-template-id', 'access-token');

    await vi.advanceTimersByTimeAsync(1500);

    await expect(result).resolves.toEqual({
      databaseId: 'database-block-id',
      dataSourceId: 'data-source-id',
    });
    expect(notionMocks.blocksChildrenList).toHaveBeenCalledTimes(2);
    expect(notionMocks.request).toHaveBeenCalledWith({
      method: 'get',
      path: 'databases/database-block-id',
    });
  });
});
