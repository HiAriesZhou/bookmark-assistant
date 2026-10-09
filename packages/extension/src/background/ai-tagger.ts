// AI features are disabled for now - focusing on core functionality
// These will be added back as advanced features in the future

export async function generateTags(title: string, content: string): Promise<string[]> {
  // AI features disabled - use simple tag extraction only
  console.log('🏷️ Using simple tag extraction (AI features disabled)');
  return extractSimpleTags(title, content);
}

export async function summarizeContent(content: string): Promise<string> {
  // AI features disabled - use simple summary only
  console.log('📝 Using simple summary (AI features disabled)');
  return createSimpleSummary(content);
}

function createSimpleSummary(content: string): string {
  // Create a more intelligent simple summary
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  if (sentences.length >= 2) {
    return `${sentences.slice(0, 2).join('. ').trim()}.`;
  }
  return `${content.substring(0, 200).trim()}...`;
}
function extractSimpleTags(title: string, content: string): string[] {
  // Simple fallback tag extraction based on keywords
  const text = `${title} ${content}`.toLowerCase();
  const commonTags = [
    'technology',
    'programming',
    'design',
    'business',
    'science',
    'web development',
    'javascript',
    'react',
    'typescript',
    'ai',
    'machine learning',
    'tutorial',
    'documentation',
    'blog',
    'news',
    'research',
    'productivity',
    'tool',
    'api',
  ];

  const foundTags = commonTags.filter((tag) => text.includes(tag));

  // If no common tags found, extract potential keywords
  if (foundTags.length === 0) {
    const words = text.match(/\b[a-z]{4,}\b/g) || [];
    const uniqueWords = [...new Set(words)];
    return uniqueWords.slice(0, 3);
  }

  return foundTags.slice(0, 5);
}
