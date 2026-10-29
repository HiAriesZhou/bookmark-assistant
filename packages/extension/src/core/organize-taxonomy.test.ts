import { describe, expect, it } from 'vitest';
import { OrganizeResponseError, type OrganizeItem } from './library-organize';
import {
  buildAssignPrompt,
  buildFolderMapPrompt,
  categoryOfFolder,
  categoryOfNewFolderId,
  newCategoryFolderId,
  organizeCategoryName,
  parseAssignResponse,
  parseFolderMapResponse,
  planCategoryMoves,
  resolveCategoryTargets,
  sampleOrganizeFolders,
} from './organize-taxonomy';

const folders = [
  { id: '1', path: 'Bookmarks Bar' },
  { id: '10', parentId: '1', path: 'Bookmarks Bar / archive' },
  { id: '12', parentId: '10', path: 'Bookmarks Bar / archive / Job' },
  { id: '13', parentId: '12', path: 'Bookmarks Bar / archive / Job / Interviews' },
  { id: '20', parentId: '1', path: 'Bookmarks Bar / Careers' },
];
const parentOf = new Map(folders.map((folder) => [folder.id, folder.parentId]));

const items: OrganizeItem[] = [
  {
    id: '100',
    parentId: '1',
    title: 'System design interview',
    url: 'https://bytebytego.com/courses/system-design-interview',
    folderPath: 'Bookmarks Bar',
  },
  {
    id: '101',
    parentId: '13',
    title: 'Mock interviews',
    url: 'https://www.hackerrank.com/ai/mock-interviews',
    folderPath: 'Bookmarks Bar / archive / Job / Interviews',
  },
];

describe('folder mapping', () => {
  it('samples non-root folders with a few titles and their direct counts', () => {
    const samples = sampleOrganizeFolders(
      folders,
      [
        { parentId: '12', title: 'LeetCode' },
        { parentId: '12', title: 'Levels.fyi' },
        { parentId: '1', title: 'Loose' },
      ],
      new Set(['1'])
    );
    expect(samples.map((sample) => sample.id)).toEqual(['10', '12', '13', '20']);
    expect(samples[1]).toEqual({
      id: '12',
      path: 'Bookmarks Bar / archive / Job',
      bookmarkCount: 2,
      sampleTitles: ['LeetCode', 'Levels.fyi'],
    });
  });

  it('describes folders by alias and keeps only known folders and categories', () => {
    const request = {
      folders: [
        { id: '12', path: 'Bookmarks Bar / archive / Job', bookmarkCount: 2, sampleTitles: [] },
        { id: '20', path: 'Bookmarks Bar / Careers', bookmarkCount: 0, sampleTitles: [] },
      ],
    };
    const prompt = buildFolderMapPrompt(request);
    expect(prompt).toContain('"f1"');
    expect(prompt).not.toContain('"12"');
    expect(
      parseFolderMapResponse(
        '```json\n{"folders":[{"folder":"f1","category":"career"},{"folder":"f2","category":"jobs"},{"folder":"f9","category":"life"}]}\n```',
        request
      )
    ).toEqual({ '12': 'career' });
    expect(() => parseFolderMapResponse('{"other":[]}', request)).toThrow(OrganizeResponseError);
  });
});

describe('assignment', () => {
  it('asks for one purpose category per bookmark with the site shown separately', () => {
    const prompt = buildAssignPrompt(items, 'zh-CN');
    expect(prompt).toContain('"site":"bytebytego.com"');
    expect(prompt).toContain('"b2"');
    expect(prompt).not.toContain('"100"');
    expect(prompt).toContain('Simplified Chinese');
    expect(prompt).toContain('interview preparation of any kind');
  });

  it('tells the model which category a bookmark already sits in, so re-runs stay put', () => {
    const prompt = buildAssignPrompt(
      [
        { ...items[1], currentCategory: 'career' },
        { ...items[0], currentCategory: 'nope' },
      ],
      'en'
    );
    expect(prompt).toContain('"current_category":"career"');
    expect(prompt).not.toContain('"current_category":"nope"');
  });

  it('keeps one answer per known bookmark and treats unknown categories as unsorted', () => {
    const assignments = parseAssignResponse(
      JSON.stringify({
        items: [
          { item: 'b1', reason: 'Interview prep', category: 'career', confidence: 'high' },
          { item: 'b1', category: 'learning' },
          { item: 'b2', reason: 'x'.repeat(300), category: 'engineering' },
          { item: 'b9', category: 'career' },
          'garbage',
        ],
      }),
      items
    );
    expect(assignments).toEqual([
      { bookmarkId: '100', category: 'career', confident: true, reason: 'Interview prep' },
      { bookmarkId: '101', category: 'unsorted', confident: false, reason: 'x'.repeat(120) },
    ]);
    expect(
      parseAssignResponse('{"items":[{"item":"b1","category":"fun","confidence":"low"}]}', items)[0]
        .confident
    ).toBe(false);
    expect(() => parseAssignResponse('not json', items)).toThrow(OrganizeResponseError);
  });
});

describe('planning moves', () => {
  const counts = new Map([
    ['12', 3],
    ['20', 1],
  ]);

  it('reuses the busiest mapped folder per category and plans new folders for the rest', () => {
    const targets = resolveCategoryTargets({ '12': 'career', '20': 'career' }, folders, counts);
    expect(targets.career).toBe('12');
    expect(targets.tools).toBe(newCategoryFolderId('tools'));
    expect(categoryOfNewFolderId(targets.tools)).toBe('tools');
    expect(categoryOfNewFolderId('12')).toBeUndefined();
    expect(organizeCategoryName('career', 'zh-CN')).toBe('求职与职业');
    expect(organizeCategoryName('career', 'en')).toBe('Career');
  });

  it('leaves bookmarks already inside a folder that serves their category', () => {
    const folderMap = { '12': 'career' as const };
    expect(categoryOfFolder('13', folderMap, parentOf)).toBe('career');
    const targets = resolveCategoryTargets(folderMap, folders, counts);
    const proposals = planCategoryMoves(
      [
        { bookmarkId: '100', category: 'career', confident: true, reason: 'Interview prep' },
        { bookmarkId: '101', category: 'career', confident: true, reason: 'Mock interviews' },
      ],
      items,
      folderMap,
      targets,
      parentOf
    );
    expect(proposals).toEqual([
      {
        bookmarkId: '100',
        fromParentId: '1',
        toFolderId: '12',
        category: 'career',
        confident: true,
        reason: 'Interview prep',
      },
    ]);
  });

  it('never moves unsorted bookmarks and keeps low confidence visible', () => {
    const targets = resolveCategoryTargets({}, folders, counts);
    const proposals = planCategoryMoves(
      [
        { bookmarkId: '100', category: 'unsorted', confident: false, reason: '' },
        { bookmarkId: '101', category: 'learning', confident: false, reason: 'Maybe docs' },
      ],
      items,
      {},
      targets,
      parentOf
    );
    expect(proposals).toEqual([
      expect.objectContaining({
        bookmarkId: '101',
        toFolderId: newCategoryFolderId('learning'),
        confident: false,
      }),
    ]);
  });
});
