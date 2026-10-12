import { describe, expect, it } from 'vitest';
import { hasNotionDestination, readSessionExpiry, shouldRenewSession } from './account-state';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-10-12T00:00:00.000Z');

function token(exp: number) {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'HS256' })}.${encode({ userId: 'u', exp: exp / 1000 })}.sig`;
}

describe('account state', () => {
  it('treats Notion as connected only for a signed-in account that linked it', () => {
    expect(hasNotionDestination({})).toBe(false);
    expect(hasNotionDestination({ notion_connected: true })).toBe(false);
    expect(hasNotionDestination({ session_token: 't', notion_connected: false })).toBe(false);
    expect(hasNotionDestination({ session_token: 't', notion_connected: true })).toBe(true);
  });

  it('keeps sessions created before notion_connected existed connected to Notion', () => {
    expect(hasNotionDestination({ session_token: 'legacy' })).toBe(true);
  });

  it('reads the session expiry', () => {
    expect(readSessionExpiry(token(now + DAY))).toBe(now + DAY);
    expect(readSessionExpiry('opaque')).toBeNull();
  });

  it('renews a session after its first day and old 24-hour sessions immediately', () => {
    expect(shouldRenewSession(token(now + 14 * DAY - 60_000), now)).toBe(false);
    expect(shouldRenewSession(token(now + 13 * DAY - 60_000), now)).toBe(true);
    expect(shouldRenewSession(token(now + 2 * 60 * 60 * 1000), now)).toBe(true);
  });

  it('does not try to renew an expired or unreadable session', () => {
    expect(shouldRenewSession(token(now - 1), now)).toBe(false);
    expect(shouldRenewSession('opaque', now)).toBe(false);
  });
});
