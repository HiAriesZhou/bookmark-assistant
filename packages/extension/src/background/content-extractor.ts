import {
  createFallbackPageContent,
  extractPageContentFromDocument,
  isValidHttpUrl,
  type PageContent,
} from '../core';

export async function extractPageContent(url: string): Promise<PageContent> {
  try {
    console.log('📄 Extracting page content');

    // Validate URL first
    if (!url || !isValidHttpUrl(url)) {
      console.warn('📄 Invalid URL provided, using fallback content');
      return createFallbackPageContent(url);
    }

    // Get the current active tab or find tab with the URL
    const tabs = await chrome.tabs.query({ url: url });
    if (tabs.length === 0) {
      console.log('📄 No matching tabs found, trying active tab...');
      // Try to get the active tab as fallback
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (activeTab?.id && activeTab.url === url) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: extractPageContentFromDocument,
          });

          if (results[0]?.result) {
            console.log('✅ Content extracted from active tab');
            return results[0].result;
          }
        } catch (scriptError) {
          console.warn('📄 Script execution on active tab failed:', scriptError);
        }
      }
    } else {
      console.log('📄 Found matching tab, extracting content...');
      // Execute script on the found tab
      const tab = tabs[0];
      if (tab.id) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractPageContentFromDocument,
          });

          if (results[0]?.result) {
            console.log('✅ Content extracted successfully');
            return results[0].result;
          }
        } catch (scriptError) {
          console.warn('📄 Script execution failed:', scriptError);
        }
      }
    }

    console.log('📄 Falling back to URL-based extraction...');
    // Fallback: extract basic info from URL
    return createFallbackPageContent(url);
  } catch (error) {
    console.error('📄 Content extraction failed:', error);
    return createFallbackPageContent(url);
  }
}
