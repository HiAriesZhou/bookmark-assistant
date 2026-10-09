import { createHash, randomUUID } from 'crypto';
import type { PublicPageDomainLimiter } from './public-page-fetcher';
import { prisma } from './userPrisma';

const DOMAIN_CONCURRENCY = 2;
const DOMAIN_REQUEST_INTERVAL_MS = 250;
const DOMAIN_LEASE_MS = 30_000;
const DOMAIN_ACQUIRE_TIMEOUT_MS = 10_000;

/** Coordinates public-page requests across Vercel instances without storing hostnames. */
export class PrismaPublicPageDomainLimiter implements PublicPageDomainLimiter {
  async acquire(hostname: string): Promise<() => Promise<void>> {
    const domainHash = hashDomain(hostname);
    const leaseToken = randomUUID();
    const deadline = Date.now() + DOMAIN_ACQUIRE_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const claim = await this.tryAcquire(domainHash, leaseToken);
      if (claim.slot !== undefined) {
        return async () => {
          await prisma.aiFetchDomainLease.updateMany({
            where: { domainHash, slot: claim.slot, leaseToken },
            data: { leaseToken: null, leaseExpiresAt: null },
          });
        };
      }
      await delay(Math.min(Math.max(claim.retryAfterMs, 25), 250));
    }
    throw new Error('Public page domain capacity is unavailable.');
  }

  private async tryAcquire(
    domainHash: string,
    leaseToken: string
  ): Promise<{ slot?: number; retryAfterMs: number }> {
    return prisma.$transaction(async (transaction) => {
      // This advisory-lock call returns PostgreSQL `void`; use $executeRaw so
      // Prisma does not try to deserialize it as a query result column.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('bookmark-assistant-domain'), hashtext(${domainHash}))`;
      const now = new Date();
      for (let slot = 0; slot < DOMAIN_CONCURRENCY; slot += 1) {
        await transaction.aiFetchDomainLease.upsert({
          where: { domainHash_slot: { domainHash, slot } },
          create: { domainHash, slot, nextRequestAt: now },
          update: {},
        });
      }
      const leases = await transaction.aiFetchDomainLease.findMany({
        where: { domainHash },
        orderBy: { slot: 'asc' },
      });
      const nextRequestAt = Math.max(...leases.map((lease) => lease.nextRequestAt.getTime()));
      const free = leases.find(
        (lease) => !lease.leaseToken || !lease.leaseExpiresAt || lease.leaseExpiresAt <= now
      );
      if (!free || nextRequestAt > now.getTime()) {
        const nextLeaseAt = Math.min(
          ...leases
            .filter(
              (lease) => lease.leaseToken && lease.leaseExpiresAt && lease.leaseExpiresAt > now
            )
            .map((lease) => lease.leaseExpiresAt!.getTime()),
          Number.POSITIVE_INFINITY
        );
        return {
          retryAfterMs: Math.max(25, Math.min(nextRequestAt, nextLeaseAt) - now.getTime()),
        };
      }

      await transaction.aiFetchDomainLease.update({
        where: { domainHash_slot: { domainHash, slot: free.slot } },
        data: {
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + DOMAIN_LEASE_MS),
        },
      });
      await transaction.aiFetchDomainLease.updateMany({
        where: { domainHash },
        data: { nextRequestAt: new Date(now.getTime() + DOMAIN_REQUEST_INTERVAL_MS) },
      });
      return { slot: free.slot, retryAfterMs: 0 };
    });
  }
}

export function hashDomain(hostname: string): string {
  return createHash('sha256').update(hostname.trim().toLowerCase()).digest('hex');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
