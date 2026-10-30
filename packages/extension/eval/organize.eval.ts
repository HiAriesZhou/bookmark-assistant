// Real-provider evaluation for AI organize. Not part of the normal test run:
//   pnpm eval:organize
// Reads the key from ~/.config/bookmark-assistant/ai-test.key (never printed) and the provider
// from BA_EVAL_PROVIDER (default deepseek).
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isAiProvider, type AiProvider } from '@bookmark-assistant/types';
import { expect, it } from 'vitest';
import { createAiProviderAdapter } from '../src/ai/providers';
import { chunkOrganizeItems, toShareableBookmarkUrl, type OrganizeItem } from '../src/core';
import {
  buildAssignPrompt,
  buildFolderMapPrompt,
  categoryOfFolder,
  parseAssignResponse,
  parseFolderMapResponse,
  sampleOrganizeFolders,
  type OrganizeAssignment,
  type OrganizeFolderMap,
} from '../src/core/organize-taxonomy';
import {
  EVAL_BOOKMARKS,
  EVAL_EXPECTED_FOLDER_MAP,
  EVAL_FOLDERS,
  EVAL_ROOT_FOLDER_IDS,
} from './organize-fixture';

const KEY_FILE = join(homedir(), '.config/bookmark-assistant/ai-test.key');
const provider = (process.env.BA_EVAL_PROVIDER ?? 'deepseek') as AiProvider;
const runs = Number(process.env.BA_EVAL_RUNS ?? 2);
const batchSize = Number(process.env.BA_EVAL_BATCH ?? 20);
const lowLatency = process.env.BA_EVAL_THINKING !== '1';
const log = (line: string) => process.stdout.write(`${line}\n`);

const pathOf = new Map(EVAL_FOLDERS.map((folder) => [folder.id, folder.path]));
const parentOf = new Map(
  EVAL_FOLDERS.map((folder) => [folder.id, (folder as { parentId?: string }).parentId])
);
const items: OrganizeItem[] = EVAL_BOOKMARKS.map((bookmark) => ({
  id: bookmark.id,
  parentId: bookmark.parentId,
  title: bookmark.title,
  url: toShareableBookmarkUrl(bookmark.url)!,
  folderPath: pathOf.get(bookmark.parentId)!,
}));

it(`organizes the evaluation library with ${provider}`, { timeout: 15 * 60_000 }, async () => {
  expect(isAiProvider(provider)).toBe(true);
  expect(Number.isInteger(runs) && runs >= 2, 'BA_EVAL_RUNS must be an integer of at least 2').toBe(
    true
  );
  expect(
    Number.isInteger(batchSize) && batchSize >= 1,
    'BA_EVAL_BATCH must be a positive integer'
  ).toBe(true);
  if (!existsSync(KEY_FILE)) {
    throw new Error('Evaluation NOT RUN: AI test key file is missing; see README.md');
  }
  const apiKey = readFileSync(KEY_FILE, 'utf8').trim();
  if (!apiKey) throw new Error('Evaluation NOT RUN: AI test key file is empty; see README.md');
  const adapter = createAiProviderAdapter(provider, fetch);
  const generate = async (prompt: string, maxOutputTokens: number) => {
    const started = Date.now();
    const { text, outputTokens } = await adapter.generate(apiKey, prompt, {
      maxOutputTokens,
      lowLatency,
      deterministic: true,
    });
    return { text, ms: Date.now() - started, outputTokens };
  };

  const request = {
    folders: sampleOrganizeFolders(EVAL_FOLDERS, EVAL_BOOKMARKS, EVAL_ROOT_FOLDER_IDS),
  };
  const mapRuns: OrganizeFolderMap[] = [];
  for (let run = 0; run < Math.max(runs, 3); run++) {
    const response = await generate(buildFolderMapPrompt(request), 2_000);
    const mapped = parseFolderMapResponse(response.text, request);
    for (const [folderId, expected] of Object.entries(EVAL_EXPECTED_FOLDER_MAP)) {
      expect(
        mapped[folderId] ?? null,
        `Folder mapping run ${run + 1}: ${pathOf.get(folderId)}`
      ).toBe(expected);
    }
    if (mapRuns.length) {
      expect(mapped, 'Folder mapping must be stable across runs').toEqual(mapRuns[0]);
    }
    mapRuns.push(mapped);
  }
  log(`folder map stable across ${mapRuns.length} runs: true`);
  const folderMap = mapRuns[0];
  log(
    `folder map: ${JSON.stringify(
      Object.fromEntries(Object.entries(folderMap).map(([id, c]) => [pathOf.get(id), c]))
    )}`
  );
  const results: Array<Map<string, OrganizeAssignment>> = [];
  for (let run = 0; run < runs; run++) {
    const byId = new Map<string, OrganizeAssignment>();
    let slowest = 0;
    for (const batch of chunkOrganizeItems(items, batchSize)) {
      const response = await generate(
        buildAssignPrompt(
          batch.map((item) => ({
            ...item,
            currentCategory: categoryOfFolder(item.parentId, folderMap, parentOf),
          })),
          'zh-CN'
        ),
        lowLatency ? 3_000 : 8_000
      );
      slowest = Math.max(slowest, response.ms);
      for (const assignment of parseAssignResponse(response.text, batch)) {
        byId.set(assignment.bookmarkId, assignment);
      }
    }
    results.push(byId);
    log(
      `run ${run + 1}${lowLatency ? '' : ' (thinking)'}: ${byId.size}/${items.length} answered, slowest batch ${slowest} ms`
    );
  }

  const first = results[0];
  let correct = 0;
  const misses: string[] = [];
  for (const bookmark of EVAL_BOOKMARKS) {
    const got = first.get(bookmark.id);
    const accepted = Array.isArray(bookmark.expected) ? bookmark.expected : [bookmark.expected];
    const ok =
      accepted.length === 0
        ? !got || got.category === 'unsorted' || !got.confident
        : Boolean(got && accepted.includes(got.category as never));
    if (ok) correct += 1;
    else
      misses.push(
        `  ${bookmark.title} → ${got?.category ?? 'missing'}${got && !got.confident ? ' (low)' : ''}, want ${accepted.join('|') || 'unsorted'} — ${got?.reason ?? ''}`
      );
  }
  const agreement =
    results.length > 1
      ? EVAL_BOOKMARKS.filter((bookmark) =>
          results.every(
            (run) => run.get(bookmark.id)?.category === first.get(bookmark.id)?.category
          )
        ).length / EVAL_BOOKMARKS.length
      : 1;
  const accuracy = correct / EVAL_BOOKMARKS.length;
  log(`accuracy ${(accuracy * 100).toFixed(1)}%  consistency ${(agreement * 100).toFixed(1)}%`);
  for (const miss of misses) log(miss);
  for (const bookmark of EVAL_BOOKMARKS) {
    const answers = results.map((run) => run.get(bookmark.id)?.category ?? 'missing');
    if (new Set(answers).size > 1) log(`  flips: ${bookmark.title} → ${answers.join(' / ')}`);
  }

  expect(accuracy).toBeGreaterThanOrEqual(0.9);
  expect(agreement).toBeGreaterThanOrEqual(0.95);
});
