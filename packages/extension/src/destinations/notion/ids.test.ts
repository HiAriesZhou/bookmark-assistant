import { expect, it } from 'vitest';
import { isNotionId } from './ids';

it('accepts Notion ids with or without dashes and nothing else', () => {
  expect(isNotionId('1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9')).toBe(true);
  expect(isNotionId('1f2e3d4c5b6a49788695a4b3c2d1e0f9')).toBe(true);
  for (const value of [
    '',
    'db-1',
    '../users/me',
    '1f2e3d4c5b6a49788695a4b3c2d1e0f9/x',
    undefined,
  ]) {
    expect(isNotionId(value)).toBe(false);
  }
});
