/**
 * Auto-Sync Scheduler
 *
 * Manages background sync scheduling using Chrome Alarms API.
 * This module handles:
 * - Creating/clearing sync alarms based on user settings
 * - Triggering automatic bookmark syncs at configured intervals
 * - Respecting plan limits (free: 24h min, pro: 6h min)
 *
 * Storage Keys (Single Source of Truth):
 * - auto_sync_enabled: Whether auto-sync is active (primary state)
 * - auto_sync_interval_minutes: Alarm interval in minutes (precise)
 * - sync_interval_hours: User-friendly interval (UI cache, optional)
 *
 * Note: Removed redundant 'auto_sync' key to avoid state desync issues.
 */

import { serverAPI } from './server-api';

const ALARM_NAME = 'bookmarks-auto-sync';

/**
 * Schedule or reschedule the auto-sync alarm
 * @param enabled Whether auto-sync is enabled
 * @param intervalHours Sync interval in hours
 */
export async function scheduleAutoSync(
  enabled: boolean,
  intervalHours: number,
  initialDelayMinutes?: number
): Promise<void> {
  console.log(`📅 Auto-sync schedule request: enabled=${enabled}, interval=${intervalHours}h`);

  // Clear existing alarm first
  await chrome.alarms.clear(ALARM_NAME);

  if (!enabled) {
    console.log('✅ Auto-sync disabled, alarm cleared');
    await chrome.storage.local.set({ auto_sync_enabled: false });
    return;
  }

  // Validate interval (minimum 30 minutes for pro, 12 hours for free)
  const minMinutes = 30; // Will be validated against plan limits in the caller
  const periodInMinutes = Math.max(minMinutes, Math.round(intervalHours * 60));

  // Create the alarm
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes,
    delayInMinutes:
      typeof initialDelayMinutes === 'number' ? Math.max(1, initialDelayMinutes) : periodInMinutes,
  });

  // Persist state
  await chrome.storage.local.set({
    auto_sync_enabled: true,
    auto_sync_interval_minutes: periodInMinutes,
  });

  console.log(
    `✅ Auto-sync scheduled: every ${periodInMinutes} minutes (next run in ${
      typeof initialDelayMinutes === 'number' ? initialDelayMinutes : periodInMinutes
    }m)`
  );
}

/**
 * Get the current auto-sync alarm info
 */
export async function getAutoSyncStatus(): Promise<{
  enabled: boolean;
  intervalMinutes: number | null;
  nextScheduledTime: number | null;
}> {
  const alarm = await chrome.alarms.get(ALARM_NAME);
  const storage = await chrome.storage.local.get([
    'auto_sync_enabled',
    'auto_sync_interval_minutes',
  ]);

  return {
    enabled: storage.auto_sync_enabled === true,
    intervalMinutes: storage.auto_sync_interval_minutes || null,
    nextScheduledTime: alarm?.scheduledTime || null,
  };
}

/**
 * Setup alarm listener to trigger syncs
 * Should be called once during background script initialization
 */
export function setupAutoSyncListener(onSync: () => Promise<void>): void {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== ALARM_NAME) return;

    console.log('⏰ Auto-sync alarm triggered:', new Date().toISOString());

    // Double-check that auto-sync is still enabled
    const { auto_sync_enabled } = await chrome.storage.local.get('auto_sync_enabled');
    if (!auto_sync_enabled) {
      console.log('⚠️ Auto-sync disabled in storage, skipping sync');
      await chrome.alarms.clear(ALARM_NAME);
      return;
    }

    // Security: Verify Pro status with server before syncing
    // Users cannot bypass payment by modifying localStorage
    try {
      const profile = await serverAPI.getUserProfile();
      if (!profile.isPro) {
        console.warn('🚫 Auto-sync blocked: User is not Pro (server-verified)');
        await chrome.alarms.clear(ALARM_NAME);
        await chrome.storage.local.set({ auto_sync_enabled: false });
        return;
      }
    } catch (error) {
      console.error('❌ Failed to verify Pro status for auto-sync:', error);
      // On error, don't sync and disable auto-sync to prevent potential abuse
      await chrome.alarms.clear(ALARM_NAME);
      await chrome.storage.local.set({ auto_sync_enabled: false });
      return;
    }

    try {
      // The background sync entry point waits for startup recovery and joins an
      // existing manual/alarm/catch-up request if necessary.
      await onSync();
      console.log('✅ Auto-sync completed successfully');
    } catch (err) {
      console.error('❌ Auto-sync failed:', err);
      // Don't disable the alarm, let it retry next time
    }
  });

  console.log('✅ Auto-sync alarm listener registered');
}

/**
 * Restore auto-sync alarm on startup, handling catch-up if needed
 * @param onSyncNeeded Callback to execute the actual sync
 */
export async function restoreAutoSync(onSyncNeeded: () => Promise<any>): Promise<void> {
  try {
    const { auto_sync_enabled, auto_sync_interval_minutes, last_sync } =
      await chrome.storage.local.get([
        'auto_sync_enabled',
        'auto_sync_interval_minutes',
        'last_sync',
      ]);

    if (auto_sync_enabled && auto_sync_interval_minutes) {
      // Security: Verify Pro status with server before restoring auto-sync
      // Users cannot bypass payment by modifying localStorage
      try {
        const profile = await serverAPI.getUserProfile();
        if (!profile.isPro) {
          console.warn('🚫 Auto-sync restore blocked: User is not Pro (server-verified)');
          await chrome.storage.local.set({ auto_sync_enabled: false });
          return;
        }
      } catch (error) {
        console.error('❌ Failed to verify Pro status on restore:', error);
        // On error, disable auto-sync to prevent potential abuse
        await chrome.storage.local.set({ auto_sync_enabled: false });
        return;
      }

      const intervalHours = auto_sync_interval_minutes / 60;
      let initialDelay = auto_sync_interval_minutes;

      // Catch-up logic: check if we missed a sync while browser was closed
      if (last_sync) {
        const lastSyncTime = new Date(last_sync).getTime();
        const now = Date.now();
        const elapsedMinutes = (now - lastSyncTime) / (1000 * 60);

        if (elapsedMinutes >= auto_sync_interval_minutes) {
          console.log('⏰ Catch-up sync triggered on startup (missed schedule)');
          // Run immediately
          onSyncNeeded().catch((e) => console.error('Catch-up sync failed:', e));
          // Schedule next one for full interval
          initialDelay = auto_sync_interval_minutes;
        } else {
          // Schedule for remaining time
          initialDelay = Math.max(1, Math.round(auto_sync_interval_minutes - elapsedMinutes));
          console.log(`⏰ Catch-up sync scheduled in ${initialDelay} minutes`);
        }
      }

      await scheduleAutoSync(true, intervalHours, initialDelay);
    }
  } catch (err) {
    console.warn('⚠️ Failed to restore auto-sync alarm on startup:', err);
  }
}
