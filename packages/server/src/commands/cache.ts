/** Local operator-only maintenance. This command is never mounted over HTTP. */
import { descriptionCache } from '../services/description-cache';
import { deleteExpiredEmailLoginCodes } from '../services/email-login-code';
import { prisma } from '../services/userPrisma';

async function main() {
  const [operation, value] = process.argv.slice(2);
  switch (operation) {
    case 'stats':
      console.log(await descriptionCache.getStats());
      break;
    case 'cleanup':
      console.log({
        deleted: await descriptionCache.cleanExpired(),
        emailLoginCodesDeleted: await deleteExpiredEmailLoginCodes(),
      });
      break;
    case 'invalidate':
      if (!value || !URL.canParse(value)) throw new Error('Provide a valid URL to invalidate.');
      console.log({ invalidated: await descriptionCache.invalidate(value) });
      break;
    case 'clear':
      if (value !== 'CLEAR_ALL_CACHE') throw new Error('Use: cache clear CLEAR_ALL_CACHE');
      console.log({ deleted: await descriptionCache.clearAll() });
      break;
    default:
      throw new Error('Usage: cache stats | cleanup | invalidate <url> | clear CLEAR_ALL_CACHE');
  }
}

void main()
  .catch(() => {
    console.error('Cache maintenance failed. Check the operation and database configuration.');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
