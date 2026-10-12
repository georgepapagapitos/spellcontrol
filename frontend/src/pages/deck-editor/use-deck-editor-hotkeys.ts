import { useEffect } from 'react';
import { type AnalysisTabId } from '@/lib/deck-analysis/deck-view';
import { type CardSearchPanelHandle } from '@/components/deck/CardSearchPanel';
import type { Dispatch, SetStateAction, RefObject } from 'react';

export function useDeckEditorHotkeys({
  setShowAddPanel,
  searchPanelRef,
  openAnalysisTab,
  handleViewCombos,
}: {
  setShowAddPanel: Dispatch<SetStateAction<boolean>>;
  searchPanelRef: RefObject<CardSearchPanelHandle | null>;
  openAnalysisTab: (tab: AnalysisTabId) => void;
  handleViewCombos: () => void;
}) {
  // `/` opens the search panel; `c` jumps to the Power tab and reveals the
  // combos panel; `a` opens the Coach tab (suggestions). Skipped while the user
  // is typing into another input/textarea so the keys still type literally
  // inside a rename/search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      if (e.key === '/') {
        e.preventDefault();
        setShowAddPanel(true);
        window.requestAnimationFrame(() => searchPanelRef.current?.focusInput());
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        // Combos render under the Power tab. Switch there, then reveal the
        // panel on the next frame (it only mounts once Power is active).
        openAnalysisTab('power');
        window.requestAnimationFrame(handleViewCombos);
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        openAnalysisTab('tune'); // Suggestions live under the Coach tab (view id stays 'tune').
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openAnalysisTab, handleViewCombos, searchPanelRef, setShowAddPanel]);
}
