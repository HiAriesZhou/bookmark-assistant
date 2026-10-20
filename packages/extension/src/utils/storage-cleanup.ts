/// <reference types="chrome" />

import { planStorageCleanup } from '../core';

/**
 * Main storage cleanup function
 * Call this on service worker startup to clean up storage
 */
export async function cleanupStorage(): Promise<void> {
  try {
    console.log('[StorageCleanup] Starting storage cleanup...');

    // Get all storage
    const storage = await chrome.storage.local.get(null);

    const { removeKeys: toRemove, updateValues: toUpdate } = planStorageCleanup(storage);

    if (toRemove.includes('last_sync_hash')) {
      console.log('[StorageCleanup] Removed redundant last_sync_hash field');
    }

    if (toRemove.includes('hasTriedInitialLoad')) {
      console.log('[StorageCleanup] Removed obsolete hasTriedInitialLoad field');
    }

    if (toRemove.includes('last_sync_partial_info')) {
      console.log('[StorageCleanup] Removed obsolete last_sync_partial_info field');
    }

    if ('error_reports' in toUpdate) {
      const originalCount = Array.isArray(storage['error_reports'])
        ? storage['error_reports'].length
        : 0;
      const cleanedCount = Array.isArray(toUpdate['error_reports'])
        ? toUpdate['error_reports'].length
        : 0;
      console.log(`[StorageCleanup] Cleaned error_reports: ${originalCount} → ${cleanedCount}`);
    }

    // Apply cleanup operations
    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
      console.log(`[StorageCleanup] Removed ${toRemove.length} obsolete fields`);
    }

    if (Object.keys(toUpdate).length > 0) {
      await chrome.storage.local.set(toUpdate);
      console.log(`[StorageCleanup] Updated ${Object.keys(toUpdate).length} fields`);
    }

    // Final storage size check
    const finalStorage = await chrome.storage.local.get(null);
    console.log(
      `[StorageCleanup] Storage cleanup complete. Total keys: ${Object.keys(finalStorage).length}`
    );
  } catch (error) {
    console.warn('[StorageCleanup] Storage cleanup failed:', error);
  }
}
