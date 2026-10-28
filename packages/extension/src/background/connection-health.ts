import {
  readNotionConnection,
  withCurrentDestination,
  type DestinationContext,
} from '../utils/destination-state';

/** The last known state of the Notion connection, as shown on the dashboard. */
export const DASHBOARD_CONNECTION_KEY = 'dashboard_connection';

export type CachedConnection = {
  status: 'connected' | 'degraded';
  workspaceName?: string;
  databaseName?: string;
  checkedAt: string;
  action?: 'reconnect' | 'retry';
};

/** A rejected token or a database the token cannot open needs a new connection. */
export function failureAction(error: unknown): 'reconnect' | 'retry' {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 401 || status === 403 || status === 404 ? 'reconnect' : 'retry';
}

/**
 * Records a Notion rejection seen during a sync or save, so the dashboard asks the user
 * to reconnect and scheduled syncs stop calling Notion until then.
 */
export async function recordConnectionFailure(
  context: DestinationContext,
  error: unknown
): Promise<'reconnect' | 'retry'> {
  const action = failureAction(error);
  if (action !== 'reconnect') return action;
  const connection = await readNotionConnection();
  const degraded: CachedConnection = {
    status: 'degraded',
    workspaceName: connection?.database.workspaceName,
    databaseName: connection?.database.title,
    checkedAt: new Date().toISOString(),
    action,
  };
  await withCurrentDestination(context, () =>
    chrome.storage.local.set({ [DASHBOARD_CONNECTION_KEY]: degraded })
  );
  return action;
}

export async function connectionNeedsReconnect(): Promise<boolean> {
  const stored = await chrome.storage.local.get(DASHBOARD_CONNECTION_KEY);
  return (stored[DASHBOARD_CONNECTION_KEY] as CachedConnection | undefined)?.action === 'reconnect';
}
