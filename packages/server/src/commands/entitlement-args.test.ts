/**
 * Unit tests for the local entitlement command arguments.
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { parseEntitlementCommand } from './entitlement-args';

const now = new Date('2026-10-12T00:00:00.000Z');

describe('entitlement command arguments', () => {
  it('grants permanent developer Pro by default', () => {
    expect(parseEntitlementCommand(['grant', ' Dev@Example.com '], now)).toEqual({
      operation: 'grant',
      email: 'dev@example.com',
      source: 'developer',
      expiresAt: null,
    });
  });

  it('keeps a dated grant valid through the end of its expiry day', () => {
    const command = parseEntitlementCommand(
      ['grant', 'friend@example.com', '--source', 'gift', '--expires', '2027-01-31'],
      now
    );
    expect(command).toMatchObject({ source: 'gift' });
    expect(command.operation === 'grant' && command.expiresAt?.toISOString()).toBe(
      '2027-01-31T23:59:59.999Z'
    );
  });

  it.each([
    [['delete', 'a@example.com'], 'Unknown operation.'],
    [['grant', 'not-an-email'], 'Provide a valid email address.'],
    [
      ['grant', 'a@example.com', '--source', 'paddle'],
      '--source must be developer, gift or trial.',
    ],
    [['grant', 'a@example.com', '--source', 'trial'], 'A trial grant requires --expires.'],
    [['grant', 'a@example.com', '--expires', '2026-01-01'], '--expires must be in the future.'],
    [['grant', 'a@example.com', '--expires', 'soon'], '--expires must be YYYY-MM-DD.'],
    [['grant', 'a@example.com', '--expires'], '--expires requires a value.'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseEntitlementCommand(argv, now)).toThrow(message);
  });

  it('accepts show and revoke with only an email', () => {
    expect(parseEntitlementCommand(['revoke', 'a@example.com'], now)).toEqual({
      operation: 'revoke',
      email: 'a@example.com',
    });
  });
});
