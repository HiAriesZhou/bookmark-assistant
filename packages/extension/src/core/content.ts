export interface PageContent {
  text: string;
  title: string;
  description?: string;
  keywords?: string[];
  /** The document identity returned with extracted content for race-free callers. */
  url?: string;
}

export function isValidHttpUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return ['http:', 'https:'].includes(urlObj.protocol);
  } catch {
    return false;
  }
}

export function createFallbackPageContent(url: string): PageContent {
  try {
    const urlObj = new URL(url);
    const hostnameWithoutPrefix = urlObj.hostname.replace('www.', '');

    return {
      text: `Content from ${urlObj.hostname}`,
      title: hostnameWithoutPrefix + urlObj.pathname,
      description: `Bookmarked from ${urlObj.hostname}`,
      keywords: [hostnameWithoutPrefix],
    };
  } catch {
    return {
      text: '',
      title: url,
      description: 'Bookmarked URL',
      keywords: ['bookmark'],
    };
  }
}

export function extractPageContentFromDocument(documentRef: Document = document): PageContent {
  const getMetaContent = (selector: string): string | undefined => {
    return documentRef.querySelector(selector)?.getAttribute('content') || undefined;
  };

  const title =
    documentRef.title ||
    documentRef.querySelector('h1')?.textContent?.trim() ||
    getMetaContent('meta[property="og:title"]') ||
    'Untitled';

  const description =
    getMetaContent('meta[name="description"]') ||
    getMetaContent('meta[property="og:description"]') ||
    getMetaContent('meta[name="twitter:description"]');

  const keywordsContent = getMetaContent('meta[name="keywords"]');
  const keywords = keywordsContent
    ? keywordsContent
        .split(',')
        .map((keyword) => keyword.trim())
        .filter(Boolean)
    : undefined;

  let content = '';
  const contentSelectors = [
    'main',
    'article',
    '[role="main"]',
    '.content',
    '.post-content',
    '.entry-content',
    '.article-content',
  ];

  for (const selector of contentSelectors) {
    const element = documentRef.querySelector(selector) as HTMLElement | null;
    if (element) {
      const text = element.innerText || element.textContent || '';
      if (text.trim().length > 100) {
        content = text;
        break;
      }
    }
  }

  if (!content || content.trim().length < 100) {
    const clonedBody = documentRef.body.cloneNode(true) as HTMLElement;
    const removableElements = clonedBody.querySelectorAll(
      'script, style, nav, footer, aside, .sidebar, .navigation'
    );
    removableElements.forEach((element) => element.remove());

    content = clonedBody.innerText || clonedBody.textContent || '';
  }

  content = content.trim().replace(/\s+/g, ' ');

  return {
    text: content.substring(0, 5000),
    title: title.trim(),
    description,
    keywords,
    url: documentRef.location?.href,
  };
}
