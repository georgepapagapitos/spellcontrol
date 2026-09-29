import { useEffect } from 'react';

interface Entry {
  title: string;
  hub: boolean;
}

// Every mounted title, oldest first. The tab shows the newest page title, or
// the newest hub title when no page has one. A stack rather than each hook
// restoring "whatever was there before": the app shell and the page both set
// a title, React runs a child's effect before its parent's, and arriving at a
// deck from Home (chunk already loaded, one commit) let the shell's "Decks"
// overwrite the deck's name.
const entries: Entry[] = [];
let base = '';

function apply(): void {
  let top: Entry | undefined;
  for (const e of entries) if (!e.hub) top = e;
  top ??= entries[entries.length - 1];
  document.title = top ? `${top.title} · SpellControl` : base;
}

/**
 * Sets the browser tab title for as long as this component is mounted. When
 * it unmounts, the tab falls back to the next title still mounted, or to the
 * title the page loaded with, so a stack of public pages (Discover, a deck, a
 * share link) never leaves a stale title behind for the next route.
 * Public/share surfaces are often a stranger's first contact and can have
 * several tabs open at once; a distinct title beats the generic app default
 * in both the tab strip and a bookmark.
 *
 * `hub: true` marks a section-level fallback (the app shell's "Decks"): any
 * page title outranks it, whichever mounted first.
 *
 * Pass `null`/`undefined` to skip (e.g. while a page's data is still loading
 * and has no name yet) — the title is left exactly as it was.
 */
export function useDocumentTitle(
  title: string | null | undefined,
  { hub = false }: { hub?: boolean } = {}
): void {
  useEffect(() => {
    if (!title) return;
    if (entries.length === 0) base = document.title;
    const entry: Entry = { title, hub };
    entries.push(entry);
    apply();
    return () => {
      entries.splice(entries.indexOf(entry), 1);
      apply();
    };
  }, [title, hub]);
}
