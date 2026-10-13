import { printingFinishKey } from '@spellcontrol/binder-routing';
import type { BinderPage } from '@/types/index';

/** The query parameter that opens a binder at one copy's pocket. */
export const LOCATE_COPY_PARAM = 'copy';

/** A link that opens the binder's page viewer at this copy's page. */
export function binderCopyHref(binderId: string, copyId: string): string {
  return `/collection/binders/${binderId}?${LOCATE_COPY_PARAM}=${encodeURIComponent(copyId)}`;
}

export interface LocatedCopy {
  /** Index into the binder's flat page run. */
  pageIndex: number;
  /** The copy in the pocket to mark. */
  copyId: string;
  /** 1-based pocket on that page. */
  slot: number;
}

/**
 * Where a copy sits in a binder's page run. The copy itself first; failing
 * that, a copy of the same printing, since "Group printings" files one copy
 * per printing and the one it keeps may not be the one asked for.
 */
export function findCopyPage(
  pages: readonly BinderPage[],
  copyId: string,
  printing?: { scryfallId: string; finish?: string; foil?: boolean }
): LocatedCopy | null {
  const key = printing ? printingFinishKey(printing) : null;
  let fallback: LocatedCopy | null = null;
  for (let p = 0; p < pages.length; p++) {
    const slots = pages[p].slots;
    for (let s = 0; s < slots.length; s++) {
      const card = slots[s];
      if (!card) continue;
      if (card.copyId === copyId) return { pageIndex: p, copyId, slot: s + 1 };
      if (!fallback && key && printingFinishKey(card) === key)
        fallback = { pageIndex: p, copyId: card.copyId, slot: s + 1 };
    }
  }
  return fallback;
}
