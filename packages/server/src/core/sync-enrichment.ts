export function readRichTextProperty(page: any, propertyId: string): string {
  const properties = page?.properties;
  if (!properties || typeof properties !== 'object') return '';
  const property = Object.values(properties).find((candidate: any) => {
    if (!candidate || candidate.type !== 'rich_text') return false;
    if (candidate.id === propertyId) return true;
    try {
      return decodeURIComponent(String(candidate.id || '')) === decodeURIComponent(propertyId);
    } catch {
      return false;
    }
  }) as any;
  if (!property || !Array.isArray(property.rich_text)) return '';
  return property.rich_text
    .map((part: any) => part?.plain_text || part?.text?.content || '')
    .join('')
    .trim();
}

export function belongsToSyncTarget(
  page: any,
  dataSourceId: string,
  databaseId?: string
): boolean {
  if (!page || page.archived || page.in_trash) return false;
  const parentDataSourceId = page.parent?.data_source_id;
  if (typeof parentDataSourceId === 'string') return parentDataSourceId === dataSourceId;
  const parentDatabaseId = page.parent?.database_id;
  return (
    typeof parentDatabaseId === 'string' &&
    typeof databaseId === 'string' &&
    parentDatabaseId === databaseId
  );
}
