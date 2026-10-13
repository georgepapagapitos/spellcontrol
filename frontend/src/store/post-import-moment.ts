import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/util/safe-local-storage';

/**
 * The "what we found in your collection" moment (board E307): shown once per
 * import, dismissible, and reopenable from the Collection page's menu.
 *
 * Device-local on purpose. It only remembers which import last announced
 * itself and whether the player has put it away; the content is computed from
 * the live collection each time, so there is nothing to sync.
 */
interface PostImportMomentState {
  /** The import that last announced the moment; null before the first one. */
  importId: string | null;
  open: boolean;
  /** `post_import_shown` has fired for `importId`, so a remount does not count it twice. */
  shownCounted: boolean;
  announce: (importId: string) => void;
  dismiss: () => void;
  /** Reopen from the menu. Not counted as a fresh "shown". */
  reopen: () => void;
  markShownCounted: () => void;
}

export const usePostImportMoment = create<PostImportMomentState>()(
  persist(
    (set) => ({
      importId: null,
      open: false,
      shownCounted: false,
      announce: (importId) => set({ importId, open: true, shownCounted: false }),
      dismiss: () => set({ open: false }),
      reopen: () => set({ open: true }),
      markShownCounted: () => set({ shownCounted: true }),
    }),
    {
      name: 'spellcontrol-post-import-moment',
      storage: createJSONStorage(() => safeLocalStorage),
    }
  )
);
