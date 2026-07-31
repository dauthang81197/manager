/**
 * Cross-component notification that a Page was renamed.
 *
 * The sidebar owns renaming, but the open Page's <h1> shows the same title.
 * Without this the heading keeps the title it was fetched with and goes
 * stale the moment the sidebar renames the page the user is looking at.
 */
export const PAGE_RENAMED_EVENT = 'my-notion:page-renamed';

export interface PageRenamedDetail {
  id: string;
  title: string;
}

export function emitPageRenamed(detail: PageRenamedDetail): void {
  window.dispatchEvent(
    new CustomEvent<PageRenamedDetail>(PAGE_RENAMED_EVENT, { detail }),
  );
}

export function onPageRenamed(
  handler: (detail: PageRenamedDetail) => void,
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<PageRenamedDetail>).detail);
  };
  window.addEventListener(PAGE_RENAMED_EVENT, listener);
  return () => window.removeEventListener(PAGE_RENAMED_EVENT, listener);
}
