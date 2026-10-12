/** Local operator-only entitlement grants. This command is never mounted over HTTP. */
import { prisma } from '../services/userPrisma';
import { parseEntitlementCommand, type EntitlementCommand } from './entitlement-args';

const USAGE = [
  'Usage:',
  '  entitlement show <email>',
  '  entitlement grant <email> [--source developer|gift|trial] [--expires YYYY-MM-DD]',
  '  entitlement revoke <email>',
  'Gift and trial grants require --expires. Paddle subscriptions are managed by webhooks.',
].join('\n');

const entitlementSelect = {
  id: true,
  email: true,
  plan: true,
  subscriptionSource: true,
  expiresAt: true,
  googleSub: true,
  notionUserId: true,
} as const;

function findAccount(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: entitlementSelect,
  });
}

function describe(account: Awaited<ReturnType<typeof findAccount>>) {
  if (!account) return { found: false };
  return {
    found: true,
    email: account.email,
    plan: account.plan,
    subscriptionSource: account.subscriptionSource,
    expiresAt: account.expiresAt?.toISOString() ?? null,
    signIn: { google: !!account.googleSub, notion: !!account.notionUserId },
  };
}

async function run(command: EntitlementCommand) {
  const existing = await findAccount(command.email);
  switch (command.operation) {
    case 'show':
      return describe(existing);
    case 'grant': {
      if (existing?.subscriptionSource === 'paddle' && existing.plan === 'pro') {
        throw new Error('Account has an active Paddle subscription; refusing to overwrite it.');
      }
      const data = {
        plan: 'pro',
        subscriptionSource: command.source,
        expiresAt: command.expiresAt,
      };
      // An account that has not signed in yet is created by email and adopted by
      // the first Google or Notion sign-in with the same verified address.
      const account = existing
        ? await prisma.user.update({ where: { id: existing.id }, data, select: entitlementSelect })
        : await prisma.user.create({
            data: { email: command.email, ...data },
            select: entitlementSelect,
          });
      return describe(account);
    }
    case 'revoke': {
      if (!existing) return describe(existing);
      if (existing.subscriptionSource === 'paddle') {
        throw new Error('Paddle subscriptions are revoked through Paddle, not this command.');
      }
      const account = await prisma.user.update({
        where: { id: existing.id },
        data: { plan: 'free', subscriptionSource: null, expiresAt: null },
        select: entitlementSelect,
      });
      return describe(account);
    }
  }
}

void (async () => {
  let command: EntitlementCommand;
  try {
    command = parseEntitlementCommand(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  try {
    console.log(await run(command));
  } catch (error) {
    const message = error instanceof Error && !('code' in error) ? error.message : '';
    console.error(
      message || 'Entitlement change failed. Check the email and database configuration.'
    );
    process.exitCode = 1;
  } finally {
    // Prisma throws on first access without DATABASE_URL; that was already reported.
    try {
      await prisma.$disconnect();
    } catch {}
  }
})();
