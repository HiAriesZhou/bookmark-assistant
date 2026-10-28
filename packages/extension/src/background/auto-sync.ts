/**
 * Auto-Sync Scheduler
 *
 * Manages background sync scheduling using Chrome Alarms API.
 * This module handles:
 * - Creating/clearing sync alarms based on user settings
 * - Triggering automatic bookmark syncs at configured intervals
 * - Running only while a Notion destination is connected
 *
 * Storage Keys (Single Source of Truth):
 * - auto_sync_enabled: Whether auto-sync is active (primary state)
 * - auto_sync_interval_minutes: Alarm interval in minutes (precise)
 * - sync_interval_hours: User-friendly interval (UI cache, optional)
 *
 * Note: Removed redundant 'auto_sync' key to avoid state desync issues.
 */

import { connectionNeedsReconnect } from './connection-health';
import {
  readDestinationContext,
  isDestinationContextCurrent,
  readNotionConnection,
  withCurrentDestination,
  type DestinationContext,
} from '../utils/destination-state';

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

  // The settings page enforces the six-hour minimum; this guards against bad input.
  const minMinutes = 30;
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
export function setupAutoSyncListener(
  onSync: (context: DestinationContext) => Promise<void>
): void {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== ALARM_NAME) return;

    const context = await readDestinationContext();
    console.log('⏰ Auto-sync alarm triggered:', new Date().toISOString());

    // Double-check that auto-sync is still enabled
    const { auto_sync_enabled } = await chrome.storage.local.get('auto_sync_enabled');
    if (!auto_sync_enabled) {
      console.log('⚠️ Auto-sync disabled in storage, skipping sync');
      await withCurrentDestination(context, () => chrome.alarms.clear(ALARM_NAME));
      return;
    }

    // Nothing to sync to after Notion was disconnected; stop the schedule.
    if (!(await readNotionConnection())) {
      console.warn('🚫 Auto-sync skipped: no Notion destination is connected');
      await withCurrentDestination(context, async () => {
        await chrome.alarms.clear(ALARM_NAME);
        await chrome.storage.local.set({ auto_sync_enabled: false });
      });
      return;
    }

    try {
      if (!(await isDestinationContextCurrent(context))) return;
      const current = await chrome.storage.local.get('auto_sync_enabled');
      if (!current.auto_sync_enabled) return;
      // Notion rejected the connection; wait for the user to reconnect.
      if (await connectionNeedsReconnect()) return;
      // The background sync entry point waits for startup recovery and joins an
      // existing manual/alarm/catch-up request if necessary.
      await onSync(context);
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
export async function restoreAutoSync(
  onSyncNeeded: (context: DestinationContext) => Promise<any>
): Promise<void> {
  try {
    const context = await readDestinationContext();
    const { auto_sync_enabled, auto_sync_interval_minutes, last_sync } =
      await chrome.storage.local.get([
        'auto_sync_enabled',
        'auto_sync_interval_minutes',
        'last_sync',
      ]);

    if (auto_sync_enabled && auto_sync_interval_minutes) {
      if (!(await readNotionConnection())) {
        await withCurrentDestination(context, () =>
          chrome.storage.local.set({ auto_sync_enabled: false })
        );
        return;
      }

      const intervalHours = auto_sync_interval_minutes / 60;
      let initialDelay = auto_sync_interval_minutes;

      // Catch-up logic: check if we missed a sync while browser was closed
      if (last_sync) {
        const lastSyncTime = new Date(last_sync).getTime();
        const now = Date.now();
        const elapsedMinutes = (now - lastSyncTime) / (1000 * 60);

        if (elapsedMinutes >= auto_sync_interval_minutes && !(await connectionNeedsReconnect())) {
          console.log('⏰ Catch-up sync triggered on startup (missed schedule)');
          // Run immediately
          onSyncNeeded(context).catch((e) => console.error('Catch-up sync failed:', e));
          // Schedule next one for full interval
          initialDelay = auto_sync_interval_minutes;
        } else {
          // Schedule for remaining time
          initialDelay = Math.max(1, Math.round(auto_sync_interval_minutes - elapsedMinutes));
          console.log(`⏰ Catch-up sync scheduled in ${initialDelay} minutes`);
        }
      }

      await withCurrentDestination(context, async () => {
        const current = await chrome.storage.local.get([
          'auto_sync_enabled',
          'auto_sync_interval_minutes',
        ]);
        if (
          current.auto_sync_enabled &&
          current.auto_sync_interval_minutes === auto_sync_interval_minutes
        )
          await scheduleAutoSync(true, intervalHours, initialDelay);
      });
    }
  } catch (err) {
    console.warn('⚠️ Failed to restore auto-sync alarm on startup:', err);
  }
}
