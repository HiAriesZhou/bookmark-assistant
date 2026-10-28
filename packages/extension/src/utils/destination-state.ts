// The Notion destination: the user's token and the database it writes to. The background
// owns these keys; the token never leaves chrome.storage.local.

export const NOTION_TOKEN_KEY = 'notion_token';
export const NOTION_DATABASE_KEY = 'notion_database';
export const DESTINATION_REVISION_KEY = 'destination_revision';

export type NotionDatabaseRef = {
  id: string;
  title?: string;
  workspaceName?: string;
};

export type DestinationContext = {
  revision: string | null;
  token: string | null;
  databaseId: string | null;
};

export type NotionConnection = { token: string; database: NotionDatabaseRef };

// Progress that describes what the previous destination already holds. A new or changed
// connection clears it so the next sync writes everything to the new database.
export const SYNC_PROGRESS_KEYS = [
  'last_sync',
  'last_sync_at',
  'last_sync_summary',
  'last_sync_count',
  'last_sync_fingerprint',
  'last_sync_payload_version',
  'last_sync_error',
  'sync_in_progress',
  'sync_started_at',
  'sync_trigger',
  'dashboard_last_sync',
  'dashboard_connection',
  'dashboard_snapshot',
];

export class StaleDestinationStateError extends Error {
  readonly code = 'STALE_DESTINATION_STATE';
  constructor() {
    super('The Notion connection changed before the request completed');
    this.name = 'StaleDestinationStateError';
  }
}

export function isStaleDestinationStateError(error: unknown): boolean {
  return error instanceof StaleDestinationStateError;
}

function readDatabase(value: unknown): NotionDatabaseRef | null {
  if (!value || typeof value !== 'object') return null;
  const database = value as Record<string, unknown>;
  if (typeof database.id !== 'string' || !database.id) return null;
  return {
    id: database.id,
    ...(typeof database.title === 'string' ? { title: database.title } : {}),
    ...(typeof database.workspaceName === 'string'
      ? { workspaceName: database.workspaceName }
      : {}),
  };
}

export function readNotionConnectionFrom(stored: Record<string, unknown>): NotionConnection | null {
  const token = stored[NOTION_TOKEN_KEY];
  const database = readDatabase(stored[NOTION_DATABASE_KEY]);
  return typeof token === 'string' && token && database ? { token, database } : null;
}

export async function readNotionConnection(): Promise<NotionConnection | null> {
  const stored = await chrome.storage.local.get([NOTION_TOKEN_KEY, NOTION_DATABASE_KEY]);
  return readNotionConnectionFrom(stored);
}

export async function readDestinationContext(): Promise<DestinationContext> {
  const stored = await chrome.storage.local.get([
    NOTION_TOKEN_KEY,
    NOTION_DATABASE_KEY,
    DESTINATION_REVISION_KEY,
  ]);
  const connection = readNotionConnectionFrom(stored);
  const revision = stored[DESTINATION_REVISION_KEY];
  return {
    revision: typeof revision === 'string' ? revision : null,
    token: connection?.token ?? null,
    databaseId: connection?.database.id ?? null,
  };
}

export function sameDestinationContext(a: DestinationContext, b: DestinationContext): boolean {
  return a.revision === b.revision && a.token === b.token && a.databaseId === b.databaseId;
}

export async function isDestinationContextCurrent(context: DestinationContext): Promise<boolean> {
  return sameDestinationContext(context, await readDestinationContext());
}

export async function assertDestinationContextCurrent(context: DestinationContext): Promise<void> {
  if (!(await isDestinationContextCurrent(context))) throw new StaleDestinationStateError();
}

// Only short local commits enter this queue; network requests must never block a disconnect.
let destinationMutation: Promise<unknown> = Promise.resolve();
export function mutateDestinationState<T>(action: () => Promise<T>): Promise<T> {
  const request = destinationMutation.then(action);
  destinationMutation = request.catch(() => undefined);
  return request;
}

/** Commits results only if the connection that started the work is still the current one. */
export function withCurrentDestination<T>(
  context: DestinationContext,
  action: () => Promise<T>
): Promise<T> {
  return mutateDestinationState(async () => {
    await assertDestinationContextCurrent(context);
    return action();
  });
}

const newRevision = () =>
  globalThis.crypto && 'randomUUID' in globalThis.crypto
    ? globalThis.crypto.randomUUID()
    : `revision-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Saves a verified connection. Work started under the previous connection is dropped. */
export function commitNotionConnection(
  expected: DestinationContext,
  connection: NotionConnection
): Promise<DestinationContext> {
  return withCurrentDestination(expected, async () => {
    const revision = newRevision();
    await chrome.storage.local.remove(SYNC_PROGRESS_KEYS);
    await chrome.storage.local.set({
      [NOTION_TOKEN_KEY]: connection.token,
      [NOTION_DATABASE_KEY]: connection.database,
      [DESTINATION_REVISION_KEY]: revision,
    });
    return { revision, token: connection.token, databaseId: connection.database.id };
  });
}

/** Removes the token and database locally. Notion keeps every page already written. */
export function clearNotionConnection(expected: DestinationContext): Promise<DestinationContext> {
  return withCurrentDestination(expected, async () => {
    const revision = newRevision();
    await chrome.storage.local.remove([
      NOTION_TOKEN_KEY,
      NOTION_DATABASE_KEY,
      ...SYNC_PROGRESS_KEYS,
    ]);
    await chrome.storage.local.set({ [DESTINATION_REVISION_KEY]: revision });
    return { revision, token: null, databaseId: null };
  });
}
