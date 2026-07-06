import { type JSX, useMemo, useState } from 'react';
import { ArrowLeftRight, ArrowRight, ChevronRight, Loader2, X } from 'lucide-react';
import './BetweenYourDecks.css';
import { useDecksStore } from '@/store/decks';
import { useCollectionStore } from '@/store/collection';
import { useAllocations } from '@/lib/allocations';
import { useTaggerReady } from '@/lib/use-tagger-ready';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { findCrossDeckMoves, type CrossDeckMove } from '@/lib/cross-deck-moves';
import { dismissCrossDeckMove, isCrossDeckMoveDismissed } from '@/lib/between-decks-dismissed';
import { useCardThumb } from '@/lib/card-thumbs';
import { getOwnedPrinting } from '@/deck-builder/services/scryfall/client';
import { WhyBreakdown } from './WhyBreakdown';
import { toast } from '@/store/toasts';
import { haptics } from '@/lib/haptics';

/** fitGain is a small integer (1-3 in practice), so it renders as discrete
 *  pips rather than a proportional bar — a bar reads as a percentage, and
 *  "Fits 1 engine" as a third-full track is a false-precision signal. Three
 *  pips because 3 reinforced engines is already a strong signal; higher
 *  gains cap the pips while the adjacent text carries the true count. */
const FIT_PIP_COUNT = 3;
/** Cap the feed so a huge collection doesn't turn this into a wall of rows —
 *  the strongest moves (highest fitGain) sort first. */
const MAX_SHOWN = 8;

function Thumb({ url, alt }: { url: string | undefined; alt: string }): JSX.Element {
  return url ? (
    <img src={url} alt="" loading="lazy" title={alt} />
  ) : (
    <span className="between-decks-art-ph" aria-hidden />
  );
}

function MoveRow({
  move,
  busy,
  onAccept,
  onDismiss,
}: {
  move: CrossDeckMove;
  busy: boolean;
  onAccept: (move: CrossDeckMove) => void;
  onDismiss: (id: string) => void;
}): JSX.Element {
  const cardThumb = useCardThumb(move.cardImageUrl ? undefined : move.cardName, 'normal');
  const replacementThumb = useCardThumb(
    move.replacementImageUrl ? undefined : move.replacementName,
    'small'
  );

  return (
    <li className="between-decks-move">
      <div className="between-decks-move-top">
        <div className="between-decks-move-cards">
          <div className="between-decks-move-card">
            <Thumb url={move.cardImageUrl ?? cardThumb} alt={move.cardName} />
            <span className="between-decks-move-card-name">{move.cardName}</span>
          </div>
          <ArrowRight className="between-decks-move-arrow" aria-hidden />
          <span
            className="between-decks-move-dest"
            style={{ ['--deck-color' as string]: move.toDeckColor }}
          >
            <span className="between-decks-move-dot" aria-hidden />
            {move.toDeckName}
          </span>
        </div>
        <div className="between-decks-move-fit">
          <span className="between-decks-fit-pips" aria-hidden>
            {Array.from({ length: FIT_PIP_COUNT }, (_, i) => (
              <span
                key={i}
                className={`between-decks-fit-pip${i < move.fitGain ? ' is-filled' : ''}`}
              />
            ))}
          </span>
          <span className="between-decks-move-fit-label">
            Fits {move.fitGain} engine{move.fitGain === 1 ? '' : 's'} in {move.toDeckName}
          </span>
        </div>
      </div>

      <WhyBreakdown factors={move.whyMove} label="Why move this?" />

      <div className="between-decks-move-replacement">
        <Thumb url={move.replacementImageUrl ?? replacementThumb} alt={move.replacementName} />
        <div className="between-decks-move-replacement-text">
          <span>
            <strong>{move.replacementName}</strong> stays in {move.fromDeckName}
          </span>
          <WhyBreakdown factors={move.whyReplacement} label="Why this replacement?" />
        </div>
      </div>

      <div className="between-decks-move-actions">
        <button
          type="button"
          className="btn btn-outline between-decks-move-dismiss"
          onClick={() => onDismiss(move.id)}
          disabled={busy}
        >
          <X width={14} height={14} aria-hidden />
          Dismiss
        </button>
        <button
          type="button"
          className="btn btn-primary between-decks-move-accept"
          onClick={() => onAccept(move)}
          disabled={busy}
          aria-label={
            busy ? `Moving ${move.cardName}` : `Move ${move.cardName} to ${move.toDeckName}`
          }
        >
          {busy ? (
            <Loader2 className="between-decks-move-spinner" aria-hidden />
          ) : (
            <ArrowLeftRight width={14} height={14} aria-hidden />
          )}
          Move
        </button>
      </div>
    </li>
  );
}

/**
 * The full suggestion list, in a `card-picker` bottom sheet (mobile) / centered
 * modal (≥1024px) — the same shared shell `MoveToDeckSheet` uses. No portal:
 * this mounts from the Decks Index page's top level, which has no
 * `transform`/`container-type` ancestor to trap `position: fixed` (verified
 * against `deck-builder-decks-index.css` / `base-layout.css`); introducing
 * `createPortal` + `useSheetExit`'s animated-close machinery (as `CardGroupSheet`
 * does) would be unused complexity here — `MoveToDeckSheet` proves the simpler
 * inline-shell path is enough for a picker sheet of this shape.
 */
function BetweenYourDecksSheet({
  moves,
  busyId,
  onAccept,
  onDismiss,
  onClose,
}: {
  moves: CrossDeckMove[];
  busyId: string | null;
  onAccept: (move: CrossDeckMove) => void;
  onDismiss: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  useLockBodyScroll();
  useEscapeKey(onClose);

  return (
    <div
      className="card-picker-root between-decks-sheet-root"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="card-picker-sheet between-decks-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Between your decks"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <header className="between-decks-sheet-head">
          <div className="between-decks-sheet-titles">
            <h2 className="between-decks-sheet-title">Between your decks</h2>
            <p className="between-decks-sheet-sub">
              Cards sleeved into the wrong deck — moved together with an owned replacement, so
              nothing is left worse off.
            </p>
          </div>
          <button
            type="button"
            className="between-decks-sheet-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X width={18} height={18} strokeWidth={2} aria-hidden />
          </button>
        </header>
        <ul className="between-decks-list between-decks-sheet-body" role="list">
          {moves.map((move) => (
            <MoveRow
              key={move.id}
              move={move}
              busy={busyId === move.id}
              onAccept={onAccept}
              onDismiss={onDismiss}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

/** One-row summary: icon, label, a count pill, and (space permitting) a
 *  teaser of the top suggestion — the sibling of the pull-readiness badge
 *  and other quiet index-page affordances, not a card panel. See
 *  STYLE_GUIDE.md "Index-page insight strips". */
function BetweenYourDecksStrip({
  moves,
  onOpen,
}: {
  moves: CrossDeckMove[];
  onOpen: () => void;
}): JSX.Element {
  const top = moves[0];
  return (
    <button type="button" className="between-decks-strip" onClick={onOpen} aria-haspopup="dialog">
      <ArrowLeftRight className="between-decks-strip-icon" aria-hidden width={16} height={16} />
      <span className="between-decks-strip-label">Between your decks</span>
      <span className="between-decks-strip-count">
        {moves.length} move{moves.length === 1 ? '' : 's'}
      </span>
      {top && (
        <span className="between-decks-strip-teaser">
          {top.cardName}
          <ArrowRight
            className="between-decks-strip-teaser-arrow"
            aria-hidden
            width={11}
            height={11}
          />
          {top.toDeckName}
        </span>
      )}
      <ChevronRight className="between-decks-strip-chevron" aria-hidden width={16} height={16} />
    </button>
  );
}

/**
 * "Between your decks" (E90): a physical-reality-aware coach lane on the Decks
 * Index page. Detects a card allocated to one deck that would decisively pull
 * more weight in a sibling deck, and proposes the move together with an owned
 * replacement that keeps the donor deck whole — see `lib/cross-deck-moves.ts`
 * for the engine and its conservative gating.
 *
 * UX-334 follow-up: the first ship rendered the full suggestion list inline,
 * pushing the deck grid below the fold. This collapses to a one-row strip
 * (mirroring `ReadinessSpotlight`'s self-contained-data pattern, but only the
 * summary, not the cards) that opens the same suggestion cards in a sheet on
 * tap. Zero visible suggestions (none found, or all dismissed) renders
 * nothing at all — no empty state on the index itself.
 */
export function BetweenYourDecks(): JSX.Element | null {
  const decks = useDecksStore((s) => s.decks);
  const addCard = useDecksStore((s) => s.addCard);
  const swapCard = useDecksStore((s) => s.swapCard);
  const replaceDeck = useDecksStore((s) => s.replaceDeck);
  const collection = useCollectionStore((s) => s.cards);
  const allocations = useAllocations();
  // The replacement search depends on the tagger's role taxonomy; recompute
  // once it finishes loading in the background (see `main.tsx`) rather than
  // silently missing every role-gated suggestion on a fast first paint.
  const taggerReady = useTaggerReady();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [, forceRerender] = useState(0);

  const moves = useMemo(
    () => findCrossDeckMoves(decks, collection, allocations, { limit: MAX_SHOWN }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- taggerReady is a recompute trigger, not read directly
    [decks, collection, allocations, taggerReady]
  );
  const visible = moves.filter((m) => !isCrossDeckMoveDismissed(m.id));

  // Render-phase adjustment (react.dev "storing information from previous
  // renders"): guarded setState during render, NOT an effect — React
  // re-renders immediately without committing the stale frame. The sheet
  // must not silently reopen on its own later — reset once the strip
  // actually disappears (dismissing the last suggestion, or an in-flight
  // recompute racing the sheet's mount) so a future batch of suggestions
  // starts collapsed, matching "dismissing the last suggestion closes the
  // sheet" rather than leaving stale open state behind.
  if (open && visible.length === 0) setOpen(false);

  if (decks.length < 2 || visible.length === 0) return null;

  const handleDismiss = (id: string) => {
    dismissCrossDeckMove(id);
    forceRerender((n) => n + 1);
  };

  const handleAccept = async (move: CrossDeckMove) => {
    setBusyId(move.id);
    try {
      const fromDeck = decks.find((d) => d.id === move.fromDeckId);
      const toDeck = decks.find((d) => d.id === move.toDeckId);
      const fromSlot = fromDeck?.cards.find((c) => c.slotId === move.slotId);
      const replacementCopy = collection.find((c) => c.copyId === move.replacementCopyId);
      if (!fromDeck || !toDeck || !fromSlot || !replacementCopy) {
        toast.show({
          message: `${move.cardName} has changed since this suggestion — refresh to see the latest`,
          tone: 'error',
        });
        return;
      }
      const replacementCard = await getOwnedPrinting(
        replacementCopy.scryfallId,
        replacementCopy.name
      );

      const snapFrom = fromDeck;
      const snapTo = toDeck;
      addCard(toDeck.id, fromSlot.card, fromSlot.allocatedCopyId);
      swapCard(fromDeck.id, fromSlot.slotId, replacementCard, replacementCopy.copyId);
      haptics.tap();
      toast.show({
        message: `Moved ${move.cardName} to ${toDeck.name} — ${replacementCopy.name} covers ${fromDeck.name}`,
        tone: 'success',
        actionLabel: 'Undo',
        onAction: () => {
          replaceDeck(fromDeck.id, snapFrom);
          replaceDeck(toDeck.id, snapTo);
          haptics.tap();
        },
      });
    } catch {
      toast.show({ message: `Couldn't move ${move.cardName}`, tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <BetweenYourDecksStrip moves={visible} onOpen={() => setOpen(true)} />
      {open && (
        <BetweenYourDecksSheet
          moves={visible}
          busyId={busyId}
          onAccept={(m) => void handleAccept(m)}
          onDismiss={handleDismiss}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
