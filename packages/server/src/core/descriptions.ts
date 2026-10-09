export type DescriptionSource = 'meta_description' | 'og_description' | 'title' | 'content' | 'empty';

export interface HtmlDescriptionResult {
  text: string;
  source: DescriptionSource;
}

export function extractDescriptionFromHtml(html: string): HtmlDescriptionResult {
  const metaDescriptionMatch = html.match(
    /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i
  );
  if (metaDescriptionMatch && metaDescriptionMatch[1]?.trim()) {
    const metaDesc = sanitizeDescription(metaDescriptionMatch[1]);
    if (isValidDescription(metaDesc)) {
      return {
        text: metaDesc,
        source: 'meta_description',
      };
    }
  }

  const ogDescriptionMatch = html.match(
    /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i
  );
  if (ogDescriptionMatch && ogDescriptionMatch[1]?.trim()) {
    const ogDesc = sanitizeDescription(ogDescriptionMatch[1]);
    if (isValidDescription(ogDesc)) {
      return {
        text: ogDesc,
        source: 'og_description',
      };
    }
  }

  const contentMatch = extractContentFromStructuredElements(html);
  if (contentMatch) {
    return contentMatch;
  }

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch && titleMatch[1]?.trim()) {
    const title = sanitizeDescription(titleMatch[1]);
    if (title.length >= 20 && title.length <= 200 && looksLikeDescription(title)) {
      return {
        text: title,
        source: 'title',
      };
    }
  }

  const bodyParagraphMatch = html.match(/<body[^>]*>[\s\S]*?<p[^>]*>([^<]{20,300})<\/p>/i);
  if (bodyParagraphMatch && bodyParagraphMatch[1]?.trim()) {
    const content = sanitizeDescription(bodyParagraphMatch[1]);
    if (content.length >= 20 && content.length <= 300) {
      return {
        text: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        source: 'content',
      };
    }
  }

  return {
    text: '',
    source: 'empty',
  };
}

export function extractContentFromStructuredElements(html: string): HtmlDescriptionResult | null {
  const structuredMatch = html.match(
    /<(?:main|article|section)[^>]*>([\s\S]*?)<\/(?:main|article|section)>/i
  );

  if (!structuredMatch) {
    return null;
  }

  const sectionContent = structuredMatch[1];
  const paragraphMatches = sectionContent.match(/<p[^>]*>([^<]{20,500})<\/p>/gi) || [];

  for (const para of paragraphMatches) {
    const contentMatch = para.match(/<p[^>]*>([^<]+)<\/p>/i);
    if (!contentMatch?.[1]) {
      continue;
    }

    const content = sanitizeDescription(contentMatch[1]);
    if (content.length >= 20 && content.length <= 400 && isValidDescription(content)) {
      return {
        text: content.length > 200 ? `${content.substring(0, 200)}...` : content,
        source: 'content',
      };
    }
  }

  return null;
}

export function looksLikeDescription(text: string): boolean {
  const trimmed = text.trim();

  if (trimmed.length < 20 || trimmed.length > 200) {
    return false;
  }

  const titlePatterns = [
    /^[\w\s]+ - [\w\s]+$/,
    /^[\w\s]+\|[\w\s]+$/,
    /^[\w\s]+::[\w\s]+$/,
    /^[\w\s]+ - Home$/,
    /^Home - [\w\s]+$/,
    /^(Login|Sign[\s-]?up|Sign[\s-]?in|Register|Contact|About|FAQ|Help)$/i,
    /^(Home|404|Error|Page Not Found)$/i,
  ];

  for (const pattern of titlePatterns) {
    if (pattern.test(trimmed)) {
      return false;
    }
  }

  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 3) {
    return false;
  }

  const descriptiveIndicators = [
    'how to',
    'what is',
    'why',
    'when',
    'where',
    'learn',
    'guide',
    'tips',
    'best',
    'top',
    'review',
    'comparison',
    'vs',
    'about',
    'introduction',
    'overview',
    'understanding',
    'explained',
    'discover',
    'find out',
  ];

  const lowerText = trimmed.toLowerCase();
  for (const indicator of descriptiveIndicators) {
    if (lowerText.includes(indicator)) {
      return true;
    }
  }

  if (/[.!?]/.test(trimmed)) {
    return true;
  }

  return wordCount >= 5;
}

export function isValidDescription(text: string): boolean {
  const trimmed = text.trim();

  if (trimmed.length < 10 || trimmed.length > 500) {
    return false;
  }

  if (trimmed.length <= 30) {
    const brandPatterns = /[-|:|]|\b(home|login|signup|register|contact|about|faq|help)\b/i;
    if (brandPatterns.test(trimmed)) {
      return false;
    }
  }

  if (trimmed === trimmed.toUpperCase() && trimmed.length < 30) {
    return false;
  }

  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 2 && trimmed.length < 30) {
    return false;
  }

  return true;
}

export function sanitizeDescription(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&[#\w]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 500);
}
