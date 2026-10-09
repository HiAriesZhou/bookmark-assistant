export const SAVE_TO_NOTION_CONTEXT_MENU_ID = 'saveToNotion';

let contextMenuUpdate: Promise<void> = Promise.resolve();

async function applyDestinationContextMenuState(): Promise<void> {
  const { session_token } = await chrome.storage.local.get('session_token');

  await new Promise<void>((resolve) => {
    chrome.contextMenus.remove(SAVE_TO_NOTION_CONTEXT_MENU_ID, () => {
      // Removing a menu that does not exist is expected during first startup.
      void chrome.runtime.lastError;
      resolve();
    });
  });

  if (!session_token) return;

  chrome.contextMenus.create({
    id: SAVE_TO_NOTION_CONTEXT_MENU_ID,
    title: chrome.i18n.getMessage('saveToNotion') || 'Save to Notion',
    contexts: ['page', 'link'],
  });
}

/**
 * Serialize updates so startup, connect, and disconnect changes cannot leave
 * a stale destination action behind in Chrome's context menu. Only this
 * feature's item is touched, so future context-menu actions remain intact.
 */
export function syncDestinationContextMenu(): Promise<void> {
  contextMenuUpdate = contextMenuUpdate
    .catch(() => undefined)
    .then(applyDestinationContextMenuState);
  return contextMenuUpdate;
}
