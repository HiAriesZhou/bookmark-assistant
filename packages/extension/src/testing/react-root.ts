import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

export type TestRoot = Root;

/** Keep DOM setup shared while individual suites own their mocks and assertions. */
export function createTestRoot(attach = true) {
  const container = document.createElement('div');
  if (attach) document.body.appendChild(container);
  return { container, root: createRoot(container) };
}

export async function cleanupTestRoot(root: Root, container: HTMLDivElement) {
  await act(async () => root.unmount());
  container.remove();
}
