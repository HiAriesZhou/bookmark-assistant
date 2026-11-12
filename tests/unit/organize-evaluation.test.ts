import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

function evaluate(scenario: string, overrides: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ba-evaluation-regression-'));
  const configFile = join(directory, 'vitest.config.mjs');
  writeFileSync(
    configFile,
    `export default ${JSON.stringify({
      root: process.cwd(),
      test: {
        environment: 'node',
        include: ['packages/extension/eval/organize.eval.ts'],
        setupFiles: [resolve('tests/fixtures/organize-evaluation.setup.ts')],
        maxWorkers: 1,
        alias: {
          '@bookmark-assistant/types': resolve('packages/types/src/index.ts'),
        },
      },
    })};\n`
  );
  try {
    const result = spawnSync(
      process.execPath,
      [resolve('node_modules/vitest/vitest.mjs'), 'run', '--config', configFile],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NO_COLOR: '1',
          BA_EVAL_PROVIDER: 'deepseek',
          BA_EVAL_RUNS: '2',
          BA_EVAL_BATCH: '20',
          BA_EVAL_THINKING: '0',
          BA_TEST_EVAL_SCENARIO: scenario,
          ...overrides,
        },
        encoding: 'utf8',
        timeout: 20_000,
      }
    );
    if (result.error) throw result.error;
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('AI organize evaluation exit status', () => {
  it(
    'passes correct, stable results regardless of mapping entry order',
    { timeout: 25_000 },
    () => {
      const result = evaluate('correct');
      expect(result.output).toContain('accuracy 100.0%');
      expect(result.output).toContain('consistency 100.0%');
      expect(result.status).toBe(0);
    }
  );

  it.each([
    ['wrong-folder', 'Folder mapping run 2'],
    ['unstable-folder', 'Folder mapping must be stable'],
    ['missing-key', 'Evaluation NOT RUN: AI test key file is missing'],
    ['empty-key', 'Evaluation NOT RUN: AI test key file is empty'],
  ])('fails rather than reporting success for %s', { timeout: 25_000 }, (scenario, message) => {
    const result = evaluate(scenario);
    expect(result.output).toContain(message);
    expect(result.status).toBe(1);
  });

  it.each([
    ['BA_EVAL_RUNS', '1', 'BA_EVAL_RUNS must be an integer of at least 2'],
    ['BA_EVAL_RUNS', '0', 'BA_EVAL_RUNS must be an integer of at least 2'],
    ['BA_EVAL_RUNS', '2.5', 'BA_EVAL_RUNS must be an integer of at least 2'],
    ['BA_EVAL_RUNS', 'NaN', 'BA_EVAL_RUNS must be an integer of at least 2'],
    ['BA_EVAL_BATCH', '0', 'BA_EVAL_BATCH must be a positive integer'],
    ['BA_EVAL_BATCH', '-1', 'BA_EVAL_BATCH must be a positive integer'],
    ['BA_EVAL_BATCH', '0.5', 'BA_EVAL_BATCH must be a positive integer'],
    ['BA_EVAL_BATCH', 'NaN', 'BA_EVAL_BATCH must be a positive integer'],
  ])('rejects %s=%s before provider calls', { timeout: 25_000 }, (key, value, message) => {
    const result = evaluate('correct', { [key]: value });
    expect(result.output).toContain(message);
    expect(result.output).not.toContain('folder map stable');
    expect(result.status).toBe(1);
  });
});
