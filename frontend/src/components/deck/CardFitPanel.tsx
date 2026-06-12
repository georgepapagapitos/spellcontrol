import './CardFitPanel.css';
import { type JSX } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import type { ScryfallCard } from '@/deck-builder/types';
import type { AddFitReport } from '@/lib/card-fit';
import type { RankedCut } from '@/lib/intelligent-cuts';
import type { Change } from '@/lib/deck-change';
import { DeckCardRow } from './DeckCardRow';

export interface CardFitPanelProps {
  /** The card being auditioned. */
  addCard: ScryfallCard;
  /** Pre-computed fit report (engine/curve/role/color + ranked cuts). */
  report: AddFitReport;
  commanderName?: string;
  /** Commit "add this card, cut that one" as a single swap. */
  onSwapCut: (cut: RankedCut) => void;
  /** Add the card without cutting (routes through the size-aware add path). */
  onAddAnyway: () => void;
  /** slotId of a swap currently in flight — disables that row. */
  busySlotId?: string | null;
  onClose: () => void;
  /**
   * For swap-row auditions: the outgoing card name. When present, that cut is
   * sorted to the top of rankedCuts so the panel leads with the suggested swap
   * target. No new computation — we just re-order the already-ranked list.
   */
  pinnedCutName?: string;
}

/** Join axis labels into a readable "A, B and C". */
function joinLabels(items: { label: string }[]): string {
  const labels = items.map((i) => i.label);
  if (labels.length <= 1) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** A one-line verdict from the engine-fit signals. */
function engineVerdict(report: AddFitReport): { tone: 'good' | 'mixed' | 'neutral'; text: string } {
  const { axesHit, axesMissed, axesNew } = report;
  if (axesHit.length > 0) {
    return { tone: 'good', text: `Strengthens your ${joinLabels(axesHit)} engine.` };
  }
  if (axesMissed.length > 0) {
    const newPart = axesNew.length > 0 ? ` It leans ${joinLabels(axesNew)} instead.` : '';
    return {
      tone: 'mixed',
      text: `Doesn't touch your ${joinLabels(axesMissed)} plan.${newPart}`,
    };
  }
  if (axesNew.length > 0) {
    return { tone: 'neutral', text: `Adds a ${joinLabels(axesNew)} angle.` };
  }
  return { tone: 'neutral', text: 'No strong synergy signal either way.' };
}

/** Adapt a ranked cut into a `type:'cut'` Change for the shared row. */
function cutToChange(cut: RankedCut): Change {
  return {
    id: cut.slotId,
    type: 'cut',
    lane: 'similar',
    name: cut.card.name,
    card: cut.card,
    reason: cut.reason,
    cmc: cut.card.cmc,
    typeLine: cut.card.type_line,
    imageUrl: cut.card.image_uris?.normal ?? cut.card.image_uris?.small,
  };
}

/**
 * Audition / what-if fit preview (E20). Shown when the user taps "Preview fit" on
 * a card-search row: instead of silently adding, it explains how the card fits the
 * deck (engine / curve / role / color) and offers a ranked, related cut to make
 * room — committing the add↔cut as one swap. Uses the house card-picker overlay
 * (bottom sheet on mobile, centered ≥600px), like DeckSizePrompt.
 */
export function CardFitPanel({
  addCard,
  report,
  commanderName,
  onSwapCut,
  onAddAnyway,
  busySlotId,
  onClose,
  pinnedCutName,
}: CardFitPanelProps): JSX.Element {
  useLockBodyScroll();
  useEscapeKey(onClose);

  const verdict = engineVerdict(report);
  const { curve, role, color } = report;
  const busy = !!busySlotId;

  // For swap-row auditions: sort the pinned cut (the outgoing card) to the top
  // so the panel leads with the natural swap target. Other cuts follow as ranked.
  const rankedCuts = pinnedCutName
    ? [
        ...report.rankedCuts.filter(
          (c) => c.card.name.toLowerCase() === pinnedCutName.toLowerCase()
        ),
        ...report.rankedCuts.filter(
          (c) => c.card.name.toLowerCase() !== pinnedCutName.toLowerCase()
        ),
      ]
    : report.rankedCuts;

  return (
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      role="presentation"
    >
      <div
        className="card-picker-sheet card-fit-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Will ${addCard.name} fit?`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <p className="card-fit-title">{addCard.name}</p>
          <p className="card-fit-subtitle">Will it fit?</p>
        </div>

        <ul className="card-fit-signals" role="list">
          <li className={`card-fit-signal is-${verdict.tone}`}>
            <span className="card-fit-signal-label">Engine</span>
            <span className="card-fit-signal-value">{verdict.text}</span>
          </li>
          <li className="card-fit-signal">
            <span className="card-fit-signal-label">Curve</span>
            <span className="card-fit-signal-value">
              {curve.cmc} CMC —{' '}
              {curve.nonlandAtCmc === 0
                ? 'no other nonland cards here'
                : `${curve.nonlandAtCmc} other ${curve.nonlandAtCmc === 1 ? 'card' : 'cards'} at this cost`}
            </span>
          </li>
          {role.label && (
            <li className="card-fit-signal">
              <span className="card-fit-signal-label">Role</span>
              <span className="card-fit-signal-value">
                {role.label} —{' '}
                {role.countInDeck === 0
                  ? 'new role for this deck'
                  : `${role.countInDeck} already in the deck`}
              </span>
            </li>
          )}
          {(!color.withinIdentity || color.colorless) && (
            <li className={`card-fit-signal${!color.withinIdentity ? ' is-mixed' : ''}`}>
              <span className="card-fit-signal-label">Color</span>
              <span className="card-fit-signal-value">
                {!color.withinIdentity
                  ? "Outside your commander's color identity"
                  : 'Colorless — slots into any deck'}
              </span>
            </li>
          )}
        </ul>

        <div className="card-fit-cuts">
          <p className="card-fit-cuts-head">
            {rankedCuts.length > 0
              ? 'Make room — cut a related card:'
              : 'No related cut found — add it and trim later.'}
          </p>
          {rankedCuts.length > 0 && (
            <ul className="card-fit-cuts-list" role="list">
              {rankedCuts.map((cut) => (
                <DeckCardRow
                  key={cut.slotId}
                  change={cutToChange(cut)}
                  commanderName={commanderName}
                  onAct={() => onSwapCut(cut)}
                  actLabel="Replace"
                  acting={busySlotId === cut.slotId}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="card-picker-footer card-fit-footer">
          <button type="button" className="btn btn-primary" onClick={onAddAnyway} disabled={busy}>
            Add without cutting
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
