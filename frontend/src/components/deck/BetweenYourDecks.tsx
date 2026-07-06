import { type JSX, useMemo, useState } from 'react';
import { ArrowRight, ArrowLeftRight, Loader2, X } from 'lucide-react';
import './BetweenYourDecks.css';
import { useDecksStore } from '@/store/decks';
import { useCollectionStore } from '@/store/collection';
import { useAllocations } from '@/lib/allocations';
import { useTaggerReady } from '@/lib/use-tagger-ready';
import { findCrossDeckMoves, type CrossDeckMove } from '@/lib/cross-deck-moves';
import { dismissCrossDeckMove, isCrossDeckMoveDismissed } from '@/lib/between-decks-dismissed';
import { useCardThumb } from '@/lib/card-thumbs';
import { getOwnedPrinting } from '@/deck-builder/services/scryfall/client';
import { WhyBreakdown } from './WhyBreakdown';
import { MeterBar } from '../shared/MeterBar';
import { toast } from '@/store/toasts';
import { haptics } from '@/lib/haptics';

/** Every axis hit counts toward the meter; 3 established engines reinforced
 *  at once is already a strong signal, so the bar reads full there rather
 *  than needing an unrealistic 5-6 to visually "complete". */
const FIT_METER_MAX = 3;
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
        <div className="between-decks-move-meter-wrap">
          <MeterBar
            value={move.fitGain}
            max={FIT_METER_MAX}
            color="var(--success)"
            className="between-decks-move-meter"
          />
          <span className="between-decks-move-meter-label">
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
 * "Between your decks" (E90): a physical-reality-aware coach lane on the Decks
 * Index page. Detects a card allocated to one deck that would decisively pull
 * more weight in a sibling deck, and proposes the move together with an owned
 * replacement that keeps the donor deck whole — see `lib/cross-deck-moves.ts`
 * for the engine and its conservative gating.
 *
 * Self-contained (pulls its own store data), mirroring `ReadinessSpotlight`'s
 * pattern — the parent page just renders `<BetweenYourDecks />`.
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
  const [, forceRerender] = useState(0);

  const moves = useMemo(
    () => findCrossDeckMoves(decks, collection, allocations, { limit: MAX_SHOWN }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- taggerReady is a recompute trigger, not read directly
    [decks, collection, allocations, taggerReady]
  );

  if (decks.length < 2) return null;

  const visible = moves.filter((m) => !isCrossDeckMoveDismissed(m.id));

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
    <section className="between-decks" aria-label="Between your decks">
      <div className="between-decks-header">
        <p className="between-decks-eyebrow">Between your decks</p>
        <p className="between-decks-hint">
          Cards sleeved into the wrong deck — moved together with an owned replacement, so nothing
          is left worse off.
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="between-decks-empty">
          <p className="between-decks-empty-tagline">Your decks are already well-sorted.</p>
          <p className="between-decks-empty-hint">
            Every allocated card is pulling its weight where it sits — or moving it wouldn&rsquo;t
            leave an owned replacement behind, so nothing gets suggested.
          </p>
        </div>
      ) : (
        <ul className="between-decks-list" role="list">
          {visible.map((move) => (
            <MoveRow
              key={move.id}
              move={move}
              busy={busyId === move.id}
              onAccept={(m) => void handleAccept(m)}
              onDismiss={handleDismiss}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
