const NOTION_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** Page and database ids go into request paths, so only real Notion ids are accepted. */
export function isNotionId(value: unknown): value is string {
  return typeof value === 'string' && NOTION_ID.test(value);
}
