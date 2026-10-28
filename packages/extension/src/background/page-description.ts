import { readPageDescription, type PageDescription } from '../core';

/**
 * The description of the page the user is saving. Uses the activeTab grant from the popup
 * or context menu click; a page that cannot be read is saved without a description.
 */
export async function readTabDescription(tabId: number, expectedUrl: string): Promise<string> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readPageDescription,
    });
    const read = injection?.result as PageDescription | undefined;
    return read?.url === expectedUrl ? (read.description ?? '') : '';
  } catch {
    return '';
  }
}
