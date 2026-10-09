import { describe, expect, it } from 'vitest';
import type { DashboardSnapshot } from '../dashboard/types';
import { createDestinationSummary } from './destination-view-model';

describe('createDestinationSummary', () => {
  it('maps provider-specific target fields into a generic destination model', () => {
    const dashboard = {
      connection: {
        provider: { id: 'notion', displayName: 'Notion' },
        workspaceName: 'Workspace',
        databaseName: 'Bookmarks',
      },
      sync: { lastSyncAt: '2026-08-19T00:00:00.000Z' },
    } as DashboardSnapshot;

    expect(createDestinationSummary(dashboard, 'connected')).toEqual({
      provider: { id: 'notion', displayName: 'Notion' },
      status: 'connected',
      workspaceName: 'Workspace',
      destinationName: 'Bookmarks',
      lastSyncAt: '2026-08-19T00:00:00.000Z',
    });
  });

  it('keeps legacy snapshots compatible with the current provider', () => {
    expect(createDestinationSummary(undefined, 'disconnected').provider).toEqual({
      id: 'notion',
      displayName: 'Notion',
    });
  });
});
