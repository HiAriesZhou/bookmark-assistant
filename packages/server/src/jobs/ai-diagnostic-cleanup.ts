import { createThrottledTask } from './throttled-task';
import { prisma } from '../services/userPrisma';

export const AI_DIAGNOSTIC_OPPORTUNISTIC_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function cleanupExpiredAiDiagnostics(): Promise<void> {
  try {
    const now = new Date();
    const staleDomainLeaseCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [diagnostics, domainLeases] = await prisma.$transaction([
      prisma.aiGenerationDiagnostic.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.aiFetchDomainLease.deleteMany({
        where: {
          updatedAt: { lt: staleDomainLeaseCutoff },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
        },
      }),
    ]);
    if (diagnostics.count)
      console.log(`[AIDiagnostics] Removed ${diagnostics.count} expired diagnostic records`);
    if (domainLeases.count)
      console.log(`[AIDiagnostics] Removed ${domainLeases.count} stale domain leases`);
  } catch {
    console.error('[AIDiagnostics] Cleanup failed');
  }
}

export function scheduleAiDiagnosticCleanup(): void {
  const daily = 24 * 60 * 60 * 1000;
  setTimeout(() => {
    void cleanupExpiredAiDiagnostics();
  }, 60_000);
  setInterval(() => {
    void cleanupExpiredAiDiagnostics();
  }, daily);
}

export function createOpportunisticAiDiagnosticCleanup(
  cleanup: () => Promise<void> = cleanupExpiredAiDiagnostics,
  intervalMs = AI_DIAGNOSTIC_OPPORTUNISTIC_CLEANUP_INTERVAL_MS
): (now?: number) => Promise<void> {
  return createThrottledTask(cleanup, intervalMs);
}

/**
 * Vercel Hobby has no resident process. AI requests therefore provide cleanup
 * opportunities, while this per-instance gate prevents a delete query per request.
 */
export const cleanupExpiredAiDiagnosticsOpportunistically =
  createOpportunisticAiDiagnosticCleanup();
