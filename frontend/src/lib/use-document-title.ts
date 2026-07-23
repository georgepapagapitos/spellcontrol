import { useEffect } from 'react';

/**
 * Sets the browser tab title for as long as this component is mounted,
 * restoring whatever was there before on unmount — so a stack of public
 * pages (Discover, a deck, a share link) never leaves a stale title behind
 * for the next route. Public/share surfaces are often a stranger's first
 * contact and can have several tabs open at once; a distinct title beats
 * the generic app default in both the tab strip and a bookmark.
 *
 * Pass `null`/`undefined` to skip (e.g. while a page's data is still loading
 * and has no name yet) — the title is left exactly as it was.
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = `${title} — SpellControl`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
