import { createPortal } from 'react-dom';
import './ReviewSheet.css';
import './RecheckLandsSheet.css';
import { type JSX, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLockBodyScroll } from '@/lib/overlays/use-lock-body-scroll';
import { useSheetExit } from '@/lib/overlays/use-sheet-exit';
import { userMessage } from '@/lib/util/user-error';
import { recheckLands, type LandRecheck, type RecheckEnv } from '@/lib/deck/recheck-lands';
import type { Change, ChangeOwnership } from '@/lib/coach/deck-change';
import type { Deck } from '@/store/decks';
import { MeterBar } from '../shared/MeterBar';
import { Button } from '@/components/shared/Button';
import { DeckCardRow } from './DeckCardRow';

export interface RecheckLandsSheetProps {
  deck: Deck;
  env: Omit<RecheckEnv, 'onProgress'>;
  ownershipFor: (name: string) => ChangeOwnership;
  onClose: () => void;
  /** Apply the checked swaps (one undo entry is the caller's job). */
  onApply: (swaps: LandRecheck['swaps']) => Promise<void>;
}

type Phase =
  | { kind: 'building'; message: string; percent: number }
  | { kind: 'review'; result: LandRecheck }
  | { kind: 'error'; message: string };

/** Which collection rule the re-check honored, in the generator's own words. */
const RULE_LINE: Record<string, string> = {
  full: 'Only lands you own.',
  available: 'Only lands you own that no other deck is using.',
  partial: 'Mostly lands you own.',
  prefer: 'Lands you own first.',
};

/**
 * Re-check lands: the generator's land step again, with this deck's saved
 * settings and the collection as it is now, listed as swaps before anything
 * changes. House card-picker overlay: a bottom sheet on phones, centered from
 * 1024px (STYLE_GUIDE § Overlays).
 */
export function RecheckLandsSheet({
  deck,
  env,
  ownershipFor,
  onClose,
  onApply,
}: RecheckLandsSheetProps): JSX.Element {
  useLockBodyScroll();
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>({
    kind: 'building',
    message: 'Reading your collection',
    percent: 2,
  });
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);
  // A run can't be canceled mid-flight; closing just drops its answer.
  // Re-armed on every mount (StrictMode runs the cleanup once after mount).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(
    onClose,
    'binder-sheet-slide-out',
    { instantAt: '(min-width: 1024px)' }
  );

  // The deck and collection as they were when the sheet opened: a re-run is
  // the Retry button's job, not every store tick's.
  const input = useRef({ deck, env });
  const run = useCallback(async () => {
    setPhase({ kind: 'building', message: 'Reading your collection', percent: 2 });
    setSkipped(new Set());
    try {
      const result = await recheckLands(input.current.deck, {
        ...input.current.env,
        onProgress: (message, percent) => {
          if (alive.current) setPhase({ kind: 'building', message, percent });
        },
      });
      if (alive.current) setPhase({ kind: 'review', result });
    } catch (e) {
      if (alive.current)
        setPhase({ kind: 'error', message: userMessage(e, "Couldn't re-check the lands.") });
    }
  }, []);
  // Once per open: StrictMode mounts twice, and two runs race their answers.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  const swaps = phase.kind === 'review' ? phase.result.swaps : [];
  const chosen = swaps.filter((_, i) => !skipped.has(i));
  const toggle = (i: number) =>
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const apply = async () => {
    setApplying(true);
    try {
      await onApply(chosen);
      beginClose();
    } finally {
      if (alive.current) setApplying(false);
    }
  };

  const strategy = deck.generationContext?.customization?.collectionStrategy ?? 'full';

  return createPortal(
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget && !applying) beginClose();
      }}
      role="presentation"
    >
      <div
        className={`card-picker-sheet review-sheet recheck-lands-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <p id={titleId} className="review-sheet-title">
            Re-check lands
          </p>
          <p className="review-sheet-subtitle">
            This deck&apos;s build settings, against your collection today.{' '}
            {RULE_LINE[strategy] ?? ''}
          </p>
        </div>

        <div className="review-sheet-body">
          {phase.kind === 'building' && (
            <div className="review-sheet-progress" aria-live="polite">
              <MeterBar
                value={phase.percent}
                size="md"
                role="progressbar"
                label="Re-checking the lands"
              />
              <p className="review-sheet-progress-text">{phase.message}</p>
            </div>
          )}

          {phase.kind === 'error' && (
            <div className="error-banner" role="alert">
              {phase.message}
            </div>
          )}

          {phase.kind === 'review' && (
            <>
              {swaps.length === 0 ? (
                <p className="review-sheet-lead">
                  No changes. These are still the lands this deck&apos;s settings pick from your
                  collection.
                </p>
              ) : (
                <ul className="list-stack list-stack--tight recheck-lands-list" role="list">
                  {swaps.map((s, i) => {
                    const change: Change = {
                      id: `${s.out.name}>${s.in.name}#${i}`,
                      type: 'swap',
                      lane: 'lands',
                      name: s.in.name,
                      card: s.in,
                      inName: s.out.name,
                      inCard: s.out,
                      reason: `Replaces ${s.out.name}`,
                      ownership: ownershipFor(s.in.name),
                      inclusion: phase.result.inclusion[s.in.name],
                      typeLine: s.in.type_line,
                      manaCost: s.in.mana_cost,
                    };
                    const on = !skipped.has(i);
                    return (
                      <li key={change.id} className={`recheck-lands-row${on ? '' : ' is-off'}`}>
                        <label className="recheck-lands-hit">
                          <input
                            type="checkbox"
                            className="recheck-lands-check"
                            checked={on}
                            onChange={() => toggle(i)}
                            aria-label={`Swap ${s.out.name} for ${s.in.name}`}
                          />
                        </label>
                        <DeckCardRow as="div" change={change} />
                      </li>
                    );
                  })}
                </ul>
              )}
              {phase.result.kept.length > 0 && (
                <p className="review-sheet-note">
                  Kept the lands you added: {phase.result.kept.join(', ')}.
                </p>
              )}
            </>
          )}
        </div>

        <div className="card-picker-footer">
          {phase.kind === 'building' && <Button onClick={() => beginClose()}>Cancel</Button>}
          {phase.kind === 'error' && (
            <>
              <Button onClick={() => beginClose()}>Close</Button>
              <Button variant="primary" onClick={() => void run()}>
                Retry
              </Button>
            </>
          )}
          {phase.kind === 'review' && (
            <>
              <Button disabled={applying} onClick={() => beginClose()}>
                {swaps.length === 0 ? 'Close' : 'Cancel'}
              </Button>
              {swaps.length > 0 && (
                <Button
                  variant="primary"
                  disabled={chosen.length === 0 || applying}
                  onClick={() => void apply()}
                >
                  Apply {chosen.length} {chosen.length === 1 ? 'swap' : 'swaps'}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
