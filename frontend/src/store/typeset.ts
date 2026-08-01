import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_TYPESET, isValidTypeSet, typeSetHref } from '../lib/typesets';

interface TypeSetState {
  typeset: string;
  setTypeSet: (id: string) => void;
}

/** id of the <link> holding the active set's webfonts (default set excluded). */
const FONT_LINK_ID = 'sc-typeset-fonts';

/**
 * Point <html data-typeset> at `id` and make sure the right font stylesheet is
 * in <head>.
 *
 * The default set's fonts are already linked statically in index.html, so it
 * needs no injected link — switching back to it removes ours rather than
 * loading the same faces twice. Sets with `href: null` (Plain) likewise carry
 * no link.
 */
function applyTypeSet(id: string): void {
  document.documentElement.setAttribute('data-typeset', id);

  const href = typeSetHref(id);
  const existing = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;

  if (!href) {
    existing?.remove();
    return;
  }
  if (existing) {
    // Assigning .href resolves to an absolute URL, so compare the same way.
    if (existing.href !== new URL(href, document.baseURI).href) existing.href = href;
    return;
  }
  const link = document.createElement('link');
  link.id = FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

export const useTypeSetStore = create<TypeSetState>()(
  persist(
    (set) => ({
      typeset: DEFAULT_TYPESET,
      setTypeSet: (id) => {
        if (!isValidTypeSet(id)) return;
        applyTypeSet(id);
        set({ typeset: id });
      },
    }),
    {
      name: 'spellcontrol-typeset',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        applyTypeSet(state && isValidTypeSet(state.typeset) ? state.typeset : DEFAULT_TYPESET);
      },
    }
  )
);

/**
 * Apply the persisted type set pre-paint, before React renders — same job as
 * bootstrapTheme(). Without it the first frame paints in the default faces and
 * then reflows when the store rehydrates, which is far more visible for type
 * than for color (every line box changes width).
 */
export function bootstrapTypeSet(): void {
  try {
    const raw = localStorage.getItem('spellcontrol-typeset');
    if (!raw) {
      applyTypeSet(DEFAULT_TYPESET);
      return;
    }
    const parsed = JSON.parse(raw) as { state?: { typeset?: string } };
    const id = parsed?.state?.typeset;
    applyTypeSet(id && isValidTypeSet(id) ? id : DEFAULT_TYPESET);
  } catch {
    applyTypeSet(DEFAULT_TYPESET);
  }
}
