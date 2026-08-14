import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { useCardThumb } from '@/lib/card-thumbs';
import { BuildReportPanel } from './BuildReportPanel';
import type { BuildReport } from '@/deck-builder/types';
import type { ComboMatch, ComboSeedContext } from '@/types/combos';
import { markBuildReportSeen } from '@/lib/build-report-seen';
import './BuildReportSheet.css';

interface Props {
  deckId: string;
  commanderName?: string;
  /** Direct art_crop URL (skips the CDN resolution step when available). */
  commanderImageUrl?: string;
  report: BuildReport;
  onClose: () => void;
  /** Open the Shared-copies review (shown only when the deck has owned-but-elsewhere cards). */
  onReviewConflicts?: () => void;
  /** Optional post-generation AI refine surface, rendered under the report.
   *  A slot rather than a direct import so this sheet stays unaware of AI and
   *  renders nothing extra when the feature is off. */
  refineSlot?: React.ReactNode;
  /** Live Spellbook one-away combos for the generated deck (E78-P4). */
  oneAwayCombos?: ComboMatch[];
  /** Owned oracle ids — ranks owned-missing-piece combos first. */
  ownedOracleIds?: ReadonlySet<string>;
  /** Combo this build was seeded from (E215) — confirms it assembled. */
  comboSeedContext?: ComboSeedContext | null;
}

/**
 * One-shot post-generation report sheet.
 *
 * Shown once immediately after deck generation completes, then never again for
 * this deck. The caller is responsible for gating render with
 * `isBuildReportSeen`; this component calls `markBuildReportSeen` when it
 * first mounts so any late re-render of the parent doesn't resurrect it.
 *
 * Dismissal paths: ✕ button, backdrop tap, Escape key — all route through
 * `useSheetExit` for a symmetric slide-down exit.
 */
export function BuildReportSheet({
  deckId,
  commanderName,
  commanderImageUrl,
  report,
  onClose,
  onReviewConflicts,
  refineSlot,
  oneAwayCombos,
  ownedOracleIds,
  comboSeedContext,
}: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  // The panel ref gives the sheet initial focus, which is what makes the
  // `onKeyDown` below reachable at all — nothing inside this subtree was ever
  // focused, so its Escape handler could not fire.
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(
    onClose,
    ['sheet-fall', 'modal-panel-out'],
    sheetRef
  );

  // Resolve commander art via CDN hook (no api.scryfall.com/format=image).
  const resolvedThumb = useCardThumb(commanderImageUrl ? undefined : commanderName, 'normal');
  const artUrl = commanderImageUrl ?? resolvedThumb;

  // Mark seen on mount so a parent re-render doesn't loop the sheet.
  // (idem-potent — markBuildReportSeen is a Set.add)
  markBuildReportSeen(deckId);

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) beginClose();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') beginClose();
  };

  return createPortal(
    <div
      className={`build-report-sheet-backdrop${isClosing ? ' is-closing' : ''}`}
      role="presentation"
      onMouseDown={handleBackdrop}
      onKeyDown={handleKey}
    >
      <div
        ref={sheetRef}
        tabIndex={-1}
        className={`build-report-sheet${isClosing ? ' is-closing' : ''}`}
        onAnimationEnd={onAnimationEnd}
        role="dialog"
        aria-modal="true"
        aria-label="Build report"
      >
        <div className="build-report-sheet-header">
          {artUrl && (
            <div className="build-report-sheet-art" aria-hidden>
              <img src={artUrl} alt="" className="build-report-sheet-art-img" />
              <div className="build-report-sheet-art-fade" aria-hidden />
            </div>
          )}
          <div className="build-report-sheet-title-row">
            {commanderName && <p className="build-report-sheet-commander">{commanderName}</p>}
            <button
              type="button"
              className="build-report-sheet-close"
              aria-label="Close build report"
              onClick={() => beginClose()}
            >
              <X width={18} height={18} strokeWidth={2} aria-hidden />
            </button>
          </div>
          <h2 className="build-report-sheet-heading">Your deck is ready</h2>
          <p className="build-report-sheet-subheading">
            Here's how it measured up to your build intent.
          </p>
        </div>
        <div className="build-report-sheet-body">
          <BuildReportPanel
            report={report}
            oneAwayCombos={oneAwayCombos}
            ownedOracleIds={ownedOracleIds}
            comboSeedContext={comboSeedContext}
          />
          {refineSlot}
        </div>
        <div className="build-report-sheet-footer">
          {onReviewConflicts && (report.claimedConflicts ?? 0) > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                beginClose();
                onReviewConflicts();
              }}
            >
              Review shared cards
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => beginClose()}>
            View my deck
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
