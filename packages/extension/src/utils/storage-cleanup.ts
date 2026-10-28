/// <reference types="chrome" />

import { planStorageCleanup } from '../core';

/** Removes keys left by earlier versions. Runs once per service worker start. */
export async function cleanupStorage(): Promise<void> {
  try {
    const storage = await chrome.storage.local.get(null);
    const { removeKeys, updateValues } = planStorageCleanup(storage);
    if (Object.keys(updateValues).length > 0) await chrome.storage.local.set(updateValues);
    if (removeKeys.length > 0) await chrome.storage.local.remove(removeKeys);
  } catch (error) {
    console.warn('[StorageCleanup] Storage cleanup failed:', error);
  }
}
