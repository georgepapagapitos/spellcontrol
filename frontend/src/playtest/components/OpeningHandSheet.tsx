import { useCallback, useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { restrictToHorizontalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import type { PlaytestCard } from '@/lib/playtest';
import type { ScryfallCard } from '@/deck-builder/types';
import { scryfallToEnrichedCard } from '@/lib/scryfall-to-enriched';
import { isKeepableHand } from '@/lib/opening-hand-sim';
import { isLand, toSimCard } from '@/lib/hand-classify';
import { CardPreview } from '@/components/CardPreview';
import { useLongPress } from '../hooks/use-long-press';
import type { PlaytestPhase } from '../store';

interface Props {
  phase: Extract<PlaytestPhase, 'opening' | 'mulligan-bottom'>;
  hand: PlaytestCard[];
  mulliganCount: number;
  /**
   * Lookup from each PlaytestCard's instance id to the underlying ScryfallCard,
   * so we can hand the full card data to `CardPreview` (manaCost, oracleText,
   * flip faces, etc.) without coupling the reducer types to ScryfallCard.
   */
  cardLookup?: Map<string, ScryfallCard>;
  deckName?: string;
  /** Leave playtest and return to the deck. The sheet is otherwise
   *  non-dismissable (Keep / Mulligan), so this is the only way out. */
  onExit?(): void;
  onKeep(): void;
  onMulligan(): void;
  onConfirmBottom(cardIds: string[]): void;
}

const MAX_MULLIGANS = 6;

export function OpeningHandSheet({
  phase,
  hand,
  mulliganCount,
  cardLookup,
  deckName,
  onExit,
  onKeep,
  onMulligan,
  onConfirmBottom,
}: Props) {
  useLockBodyScroll();
  const [selected, setSelected] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const isMulliganBottom = phase === 'mulligan-bottom';
  const requiredBottom = isMulliganBottom ? mulliganCount : 0;
  const canConfirm = isMulliganBottom && selected.length === requiredBottom;

  // Local visual order for drag-to-reorder — independent of the prop's order.
  // PlaytestCard.id is the per-instance id from the reducer and stays stable
  // for the lifetime of the hand, so it doubles as the sortable slot id.
  // Reset whenever the prop's *set* of cards changes (mulligan → new deal): a
  // fresh hand starts in deal order; a re-render of the same hand preserves
  // whatever order the user dragged it into.
  //
  // Render-phase reset (vs. useEffect) sidesteps `react-hooks/set-state-in-effect`
  // and is the official React pattern for syncing derived state from props.
  // The signature (sorted ids joined) collapses identity comparison to a string
  // diff so a same-set-different-order re-render doesn't clobber local drags.
  const handSignature = hand
    .map((c) => c.id)
    .sort()
    .join('|');
  const [order, setOrder] = useState<string[]>(() => hand.map((c) => c.id));
  const [trackedSignature, setTrackedSignature] = useState<string>(handSignature);
  if (trackedSignature !== handSignature) {
    setTrackedSignature(handSignature);
    setOrder(hand.map((c) => c.id));
  }

  const orderedHand = useMemo(() => {
    const byId = new Map(hand.map((c) => [c.id, c]));
    return order.map((id) => byId.get(id)).filter((c): c is PlaytestCard => Boolean(c));
  }, [hand, order]);

  // EnrichedCard projection for CardPreview, parallel to the *displayed*
  // order so prev/next swipes through the carousel match what the user sees.
  // Missing lookups (defensive — shouldn't happen for hand cards from the
  // user's own deck) are filtered out so we never feed CardPreview an
  // undefined.
  const previewable = useMemo(() => {
    const out: { cardId: string; enriched: ReturnType<typeof scryfallToEnrichedCard> }[] = [];
    orderedHand.forEach((c) => {
      const scry = cardLookup?.get(c.id);
      if (!scry) return;
      out.push({ cardId: c.id, enriched: scryfallToEnrichedCard(scry) });
    });
    return out;
  }, [orderedHand, cardLookup]);

  const previewCards = useMemo(() => previewable.map((p) => p.enriched), [previewable]);
  const previewLabels = useMemo(
    () => previewable.map(() => (isMulliganBottom ? 'Bottom of library' : 'Opening hand')),
    [previewable, isMulliganBottom]
  );
  const previewPages = useMemo(() => previewable.map(() => 1), [previewable]);

  // Single-hand readout for the opening (pre-mulligan) seven: land count + a
  // keep verdict via the same `isKeepableHand` heuristic the deck-view test
  // hand uses, so the two never disagree. Skipped in mulligan-bottom (you're
  // choosing cards to bottom, not judging a fresh seven) and when any card is
  // missing its ScryfallCard lookup (can't classify it reliably).
  const handStats = useMemo(() => {
    if (isMulliganBottom || !cardLookup || hand.length < 7) return null;
    const scry = hand.map((c) => cardLookup.get(c.id)).filter((c): c is ScryfallCard => Boolean(c));
    if (scry.length < hand.length) return null;
    return { lands: scry.filter(isLand).length, keepable: isKeepableHand(scry.map(toSimCard)) };
  }, [hand, cardLookup, isMulliganBottom]);

  function toggleSelect(cardId: string) {
    if (!isMulliganBottom) return;
    setSelected((cur) => {
      if (cur.includes(cardId)) return cur.filter((id) => id !== cardId);
      if (cur.length >= requiredBottom) return cur;
      return [...cur, cardId];
    });
  }

  function bottomIndex(cardId: string): number | null {
    if (!isMulliganBottom) return null;
    const i = selected.indexOf(cardId);
    return i === -1 ? null : i + 1;
  }

  const openPreview = useCallback(
    (cardId: string) => {
      const previewIdx = previewable.findIndex((p) => p.cardId === cardId);
      if (previewIdx >= 0) setPreviewIndex(previewIdx);
    },
    [previewable]
  );

  function handleCardTap(cardId: string) {
    if (isMulliganBottom) {
      toggleSelect(cardId);
      return;
    }
    openPreview(cardId);
  }

  // PointerSensor's `distance: 6` activation matches the long-press tolerance
  // (`useLongPress` also cancels on >6px movement) — gives the three gestures
  // non-overlapping thresholds: <6px + <500ms → tap, <6px + ≥500ms →
  // long-press, ≥6px → drag. KeyboardSensor adds Tab → Space → Arrows
  // reordering for keyboard / SR users.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  return (
    <div className="card-picker-root playtest-opening-root" role="presentation">
      <div className="card-picker-backdrop" />
      <div
        className="card-picker-sheet playtest-opening-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playtest-opening-title"
      >
        {/* No drag-handle: this sheet is non-dismissable — the user must
            choose Keep or Mulligan (or select N cards for the bottom in
            the mulligan-bottom phase). Showing the swipe-affordance handle
            here was misleading users into trying to drag-down to dismiss. */}
        <div className="card-picker-header">
          <div className="playtest-opening-titleRow">
            <h2 id="playtest-opening-title" className="card-picker-title">
              {isMulliganBottom ? 'Bottom of library' : 'Opening hand'}
            </h2>
            {mulliganCount > 0 && (
              <span className="playtest-opening-badge">Mulligan {mulliganCount}</span>
            )}
          </div>
          {isMulliganBottom ? (
            <p className="playtest-opening-hint">
              Tap {requiredBottom} card{requiredBottom === 1 ? '' : 's'} to send to the bottom of
              your library, in the order you tap them. Long-press to preview · drag to reorder.{' '}
              <strong>
                {selected.length}/{requiredBottom} selected
              </strong>
            </p>
          ) : (
            previewable.length > 0 && (
              <p className="playtest-opening-hint">Tap a card to enlarge · drag to reorder.</p>
            )
          )}
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
        >
          <SortableContext items={order} strategy={horizontalListSortingStrategy}>
            <div
              className="playtest-opening-cards"
              aria-label={
                isMulliganBottom
                  ? 'Hand — drag to reorder, tap to select, long-press to preview'
                  : 'Opening hand — drag to reorder, tap to preview'
              }
            >
              {orderedHand.map((c, i) => {
                const idx = bottomIndex(c.id);
                const isSel = idx !== null;
                const hasPreview = previewable.some((p) => p.cardId === c.id);
                const tappable = isMulliganBottom || hasPreview;
                return (
                  <SortableHandCard
                    key={c.id}
                    card={c}
                    visualIndex={i}
                    isSelected={isSel}
                    selectedOrdinal={idx}
                    tappable={tappable}
                    isMulliganBottom={isMulliganBottom}
                    longPressEnabled={hasPreview}
                    onTap={handleCardTap}
                    onLongPress={openPreview}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>

        {handStats && (
          <p className="playtest-opening-stats">
            <strong>{handStats.lands}</strong> {handStats.lands === 1 ? 'land' : 'lands'} ·{' '}
            <span
              className={`playtest-opening-verdict ${
                handStats.keepable ? 'is-keepable' : 'is-mulligan'
              }`}
            >
              {handStats.keepable ? 'Keepable' : 'Mulligan?'}
            </span>
          </p>
        )}

        <div className="card-picker-footer playtest-opening-footer">
          {onExit && (
            <button type="button" className="playtest-opening-back" onClick={onExit}>
              ← Back to deck
            </button>
          )}
          {isMulliganBottom ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canConfirm}
              onClick={() => onConfirmBottom(selected)}
            >
              Send {selected.length}/{requiredBottom} to bottom
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                onClick={onMulligan}
                disabled={mulliganCount >= MAX_MULLIGANS}
              >
                Mulligan
              </button>
              <button type="button" className="btn btn-primary" onClick={onKeep}>
                Keep this hand
              </button>
            </>
          )}
        </div>
      </div>

      {previewIndex !== null && previewCards[previewIndex] && (
        <CardPreview
          source="playtest"
          cards={previewCards}
          index={previewIndex}
          binderName={deckName ?? 'Opening hand'}
          sectionLabels={previewLabels}
          pageNumbers={previewPages}
          totalPages={1}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
}

interface SortableHandCardProps {
  card: PlaytestCard;
  /** Position in the displayed order, used only for stacking z-index. */
  visualIndex: number;
  isSelected: boolean;
  /** 1-based position in the bottom-of-library selection, or null when not selected. */
  selectedOrdinal: number | null;
  /** False disables the button entirely (no preview, no select). */
  tappable: boolean;
  isMulliganBottom: boolean;
  /** True when a preview is available for this card; gates the long-press handler. */
  longPressEnabled: boolean;
  onTap(cardId: string): void;
  onLongPress(cardId: string): void;
}

/**
 * Lifted out of the parent's `hand.map(...)` so each card can call its own
 * `useLongPress` + `useSortable` hooks (both store per-instance ref state).
 *
 * Three gestures share this button surface:
 * - **Tap** (<6px, <500ms): preview in opening phase, select in mulligan-bottom.
 * - **Long-press** (<6px, ≥500ms): preview. The only way to preview during
 *   mulligan-bottom since tap is reserved for selection there.
 * - **Drag** (≥6px): reorder via `@dnd-kit`.
 *
 * The thresholds are deliberately non-overlapping: dnd-kit's PointerSensor
 * `distance: 6` activation matches the long-press 6px tolerance, and the
 * long-press timer cancels on movement so a started drag never also fires
 * a preview. `consumedClick()` swallows the synthetic click that follows a
 * fired long-press so the click handler doesn't also toggle selection.
 *
 * `touch-action: none` lets dnd-kit own the touch surface for drag; the
 * inline long-press handlers still receive React's synthetic touch events
 * because those fire before browser default actions are consulted.
 */
function SortableHandCard({
  card,
  visualIndex,
  isSelected,
  selectedOrdinal,
  tappable,
  isMulliganBottom,
  longPressEnabled,
  onTap,
  onLongPress,
}: SortableHandCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });
  const longPress = useLongPress({ onLongPress: () => onLongPress(card.id) });
  const handleClick = () => {
    if (longPress.consumedClick()) return;
    onTap(card.id);
  };
  const touchHandlers = longPressEnabled
    ? {
        onTouchStart: longPress.onTouchStart,
        onTouchMove: longPress.onTouchMove,
        onTouchEnd: longPress.onTouchEnd,
        onTouchCancel: longPress.onTouchCancel,
      }
    : undefined;
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`playtest-opening-card${isSelected ? ' is-selected' : ''}${
        isDragging ? ' is-dragging' : ''
      }`}
      style={{
        zIndex: isDragging ? 50 : visualIndex,
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: 'none',
      }}
      onClick={handleClick}
      {...attributes}
      {...listeners}
      {...touchHandlers}
      aria-pressed={isMulliganBottom ? isSelected : undefined}
      aria-label={`${card.name}${isSelected ? ` — selected, position ${selectedOrdinal}` : ''}`}
      disabled={!tappable}
    >
      {card.imageUrl ? (
        <img src={card.imageUrl} alt="" draggable={false} />
      ) : (
        <span className="playtest-opening-cardName">{card.name}</span>
      )}
      {selectedOrdinal != null && (
        <span className="playtest-opening-cardBadge" aria-hidden>
          {selectedOrdinal}
        </span>
      )}
    </button>
  );
}
