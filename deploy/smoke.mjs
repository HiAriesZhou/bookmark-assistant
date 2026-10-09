/** Container-local verification with disposable fixtures; never point this at a hosted database. */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
if (process.env.SELF_HOSTED !== 'true' || process.env.BOOKMARK_ASSISTANT_SMOKE !== '1')
  throw new Error('Use only in the explicitly selected self-hosted smoke container.');
const db = new PrismaClient();
let user;
try {
  user = await db.user.create({ data: { email: `smoke-${crypto.randomUUID()}@example.test` } });
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1m' });
  const headers = { Authorization: `Bearer ${token}` };
  const profileResponse = await fetch('http://127.0.0.1:3333/api/user/profile', { headers });
  assert.equal(profileResponse.status, 200);
  const { profile } = await profileResponse.json();
  assert.equal(profile.deploymentMode, 'self-hosted');
  assert.equal(profile.commerceEnabled, false);
  assert.equal(profile.subscriptionSource, null);
  assert.deepEqual(profile.capabilities, { autoSync: true, batchAi: true });
  assert.equal((await fetch('http://127.0.0.1:3333/api/pricing')).status, 404);
  assert.equal(
    (await fetch('http://127.0.0.1:3333/api/admin/cache', { method: 'DELETE', headers })).status,
    404
  );
  assert.equal(
    (await fetch('http://127.0.0.1:3333/api/paddle/checkout-url', { method: 'POST', headers }))
      .status,
    503
  );
  console.log(
    'Self-hosted migrations, profile capabilities, commerce and administration boundaries passed.'
  );
} finally {
  if (user) await db.user.delete({ where: { id: user.id } });
  await db.$disconnect();
}
