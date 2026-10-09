import { analyzeBookmarkLibrary } from '../dashboard/library-health';
import { getReadingListItems } from '../utils/reading-list';
import { readBookmarkMetadata } from './bookmark-metadata';
import { buildLocalBookmarkIndex } from './bookmark-library';

/** Local reads must not require an account or a Destination request. */
export async function readLibrary() {
  // A failed read is not an empty library. Callers keep their last good state.
  const [tree, metadata] = await Promise.all([chrome.bookmarks.getTree(), readBookmarkMetadata()]);
  const readingList = await getReadingListItems({ fallbackBookmarkTree: tree });
  return {
    tree,
    readingList,
    health: analyzeBookmarkLibrary(tree, readingList),
    ...buildLocalBookmarkIndex(tree, metadata),
  };
}
