import { describe, expect, it } from 'vitest';
import { hashDomain } from './prisma-public-page-domain-limiter';

describe('distributed public-page domain limiter', () => {
  it('uses a stable normalized hash instead of persisting the hostname', () => {
    const hash = hashDomain(' Example.COM ');
    expect(hash).toBe(hashDomain('example.com'));
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain('example.com');
    expect(hash).not.toBe(hashDomain('example.org'));
  });
});
