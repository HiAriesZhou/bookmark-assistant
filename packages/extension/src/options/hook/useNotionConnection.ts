import { useState } from 'react';
import {
  Messages,
  NOTION_CONNECT_MESSAGE_TIMEOUT_MS,
  sendMessage,
  type NotionTargetSummary,
} from '../../utils/message';
import { readDestinationContext } from '../../utils/destination-state';

export type NotionTargets = {
  workspaceName?: string;
  databases: NotionTargetSummary[];
  pages: NotionTargetSummary[];
};

export type NotionTargetChoice = { kind: 'database' | 'page'; id: string };

/**
 * Token setup for the Notion destination: list what the token can open, then connect a
 * database or create one under a page. The background verifies and stores the token.
 */
export function useNotionConnection() {
  const [busy, setBusy] = useState(false);

  const run = async <T>(action: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try {
      return await action();
    } finally {
      setBusy(false);
    }
  };

  const listTargets = (token: string) =>
    run(async (): Promise<NotionTargets> => {
      const response = await sendMessage(
        { type: Messages.NOTION_LIST_TARGETS, token },
        { timeoutMs: NOTION_CONNECT_MESSAGE_TIMEOUT_MS }
      );
      if (!response.success) throw new Error(response.error || 'NOTION_TOKEN_REJECTED');
      return {
        workspaceName: response.workspaceName,
        databases: response.databases ?? [],
        pages: response.pages ?? [],
      };
    });

  const connect = (token: string, choice: NotionTargetChoice) =>
    run(async () => {
      const context = await readDestinationContext();
      const response = await sendMessage(
        {
          type: Messages.NOTION_CONNECT,
          token,
          destinationRevision: context.revision,
          ...(choice.kind === 'database' ? { databaseId: choice.id } : { parentPageId: choice.id }),
        },
        { timeoutMs: NOTION_CONNECT_MESSAGE_TIMEOUT_MS }
      );
      if (!response.success) throw new Error(response.error || 'NOTION_CONNECT_FAILED');
      return response.database;
    });

  return { busy, listTargets, connect };
}
