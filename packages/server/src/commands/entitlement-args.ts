export type GrantSource = 'developer' | 'gift' | 'trial';

export type EntitlementCommand =
  | { operation: 'show' | 'revoke'; email: string }
  | { operation: 'grant'; email: string; source: GrantSource; expiresAt: Date | null };

const GRANT_SOURCES = new Set<GrantSource>(['developer', 'gift', 'trial']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseEntitlementCommand(argv: string[], now = new Date()): EntitlementCommand {
  const [operation, rawEmail, ...options] = argv;
  if (operation !== 'show' && operation !== 'grant' && operation !== 'revoke') {
    throw new Error('Unknown operation.');
  }
  const email = rawEmail?.trim().toLowerCase() ?? '';
  if (!EMAIL_PATTERN.test(email)) throw new Error('Provide a valid email address.');
  if (operation !== 'grant') return { operation, email };

  const source = (readOption(options, '--source') ?? 'developer') as GrantSource;
  if (!GRANT_SOURCES.has(source)) throw new Error('--source must be developer, gift or trial.');

  const expires = readOption(options, '--expires');
  let expiresAt: Date | null = null;
  if (expires) {
    // The grant stays valid through the whole expiry day in UTC.
    expiresAt = DATE_PATTERN.test(expires) ? new Date(`${expires}T23:59:59.999Z`) : new Date('');
    if (Number.isNaN(expiresAt.getTime())) throw new Error('--expires must be YYYY-MM-DD.');
    if (expiresAt.getTime() <= now.getTime()) throw new Error('--expires must be in the future.');
  }
  if (source !== 'developer' && !expiresAt) {
    throw new Error(`A ${source} grant requires --expires.`);
  }
  return { operation, email, source, expiresAt };
}
