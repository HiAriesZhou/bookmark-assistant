export interface CurrentPageAiSettings {
  /** Legacy compatibility only. Configured AI now applies to saved pages by default. */
  singlePageEnabled?: boolean;
  properties?: {
    descriptionPropertyId?: string;
    tagsPropertyId?: string;
  };
}

export type CurrentPageAiReadiness =
  | 'ready'
  | 'not_configured'
  | 'needs_attention'
  | 'skipped_ineligible_page';

/**
 * Decides from settings alone whether current-page AI may run, so page content
 * is read only when it would actually be sent.
 */
export function currentPageAiReadiness(
  rawUrl: string,
  settings: CurrentPageAiSettings | null | undefined,
  credential: { status: string } | null | undefined
): CurrentPageAiReadiness {
  if (
    !credential ||
    !settings?.properties?.descriptionPropertyId ||
    !settings.properties.tagsPropertyId
  ) {
    return 'not_configured';
  }
  if (credential.status !== 'verified') return 'needs_attention';
  return canSendCurrentPageToAi(rawUrl, settings) ? 'ready' : 'skipped_ineligible_page';
}

/** Keeps page content in the tab unless AI is configured and the URL is safe to send. */
export function canSendCurrentPageToAi(
  rawUrl: string,
  settings: CurrentPageAiSettings | null | undefined
): boolean {
  if (!settings?.properties?.descriptionPropertyId || !settings.properties.tagsPropertyId)
    return false;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isLocalOrPrivateHost(hostname)) return false;

  return true;
}

function isLocalOrPrivateHost(hostname: string): boolean {
  // URL keeps IPv6 literals in brackets. Treat them all as private instead of
  // matching prefixes such as "fd", which ordinary domain names share.
  if (hostname.startsWith('[')) return true;
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.test') ||
    !hostname.includes('.')
  )
    return true;
  const octets = hostname.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  )
    return false;
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    octets[0] === 0 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}
