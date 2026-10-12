import { useCallback, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { Deck } from '@/store/decks';
import type { CardSearchPanelHandle } from '@/components/deck/CardSearchPanel';
import { isBuildReportSeen } from '@/lib/deck/build-report-seen';
import { OWNED_ONLY_KEY, readOwnedOnly } from './deck-editor-helpers';

/**
 * The editor's own open/closed state: every sheet and dialog flag, the add-cards
 * panel (with its search handle), and the Coach "Owned only" filter. One object so
 * the layout and overlays take it as a single group.
 */
export function useDeckEditorUi({ deck }: { deck: Deck }) {
  const location = useLocation();
  const [showAddPanel, setShowAddPanel] = useState(false);
  const searchPanelRef = useRef<CardSearchPanelHandle>(null);
  // Coach "Owned only" filter — shared by the feed and the Next-best-move hero.
  const [ownedOnly, setOwnedOnly] = useState<boolean>(readOwnedOnly);
  const handleOwnedOnlyChange = useCallback((next: boolean) => {
    setOwnedOnly(next);
    try {
      window.localStorage.setItem(OWNED_ONLY_KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, []);
  // One-shot build-report sheet: shown once immediately after deck generation.
  // Gated on BOTH the justGenerated router state (set by the build flow's
  // post-save navigate — so pre-existing generated decks never pop it) AND the
  // localStorage seen-set (so a refresh that restores history state doesn't
  // re-show it).
  const [showBuildReport, setShowBuildReport] = useState(
    () =>
      !!(
        (location.state as { justGenerated?: boolean } | null)?.justGenerated &&
        deck?.source === 'generated' &&
        deck?.buildReport &&
        !isBuildReportSeen(deck?.id ?? '')
      )
  );
  // Feedback Tool: mint/copy the suggestion link + review submitted responses.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [pullListOpen, setPullListOpen] = useState(false);
  const [primerOpen, setPrimerOpen] = useState(false);
  const [appendOpen, setAppendOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [resyncOpen, setResyncOpen] = useState(false);
  const [showSharedCopies, setShowSharedCopies] = useState(false);

  const handleToggleAddPanel = () => {
    const next = !showAddPanel;
    setShowAddPanel(next);
    if (next) {
      window.requestAnimationFrame(() => searchPanelRef.current?.focusInput());
    }
  };

  return {
    showAddPanel,
    setShowAddPanel,
    searchPanelRef,
    handleToggleAddPanel,
    ownedOnly,
    handleOwnedOnlyChange,
    showBuildReport,
    setShowBuildReport,
    feedbackOpen,
    setFeedbackOpen,
    tokensOpen,
    setTokensOpen,
    pullListOpen,
    setPullListOpen,
    primerOpen,
    setPrimerOpen,
    appendOpen,
    setAppendOpen,
    bulkEditOpen,
    setBulkEditOpen,
    resyncOpen,
    setResyncOpen,
    showSharedCopies,
    setShowSharedCopies,
  };
}
