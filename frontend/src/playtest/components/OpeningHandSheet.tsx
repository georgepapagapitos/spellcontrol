import { useCallback, useMemo, useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import type { PlaytestCard } from '@/lib/playtest';
import type { ScryfallCard } from '@/deck-builder/types';
import { scryfallToEnrichedCard } from '@/lib/scryfall-to-enriched';
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

  // EnrichedCard projection for CardPreview, parallel to `hand`. Missing
  // lookups (defensive — shouldn't happen for hand cards from the user's
  // own deck) are filtered out so we never feed CardPreview an undefined.
  const previewable = useMemo(() => {
    const out: { handIndex: number; enriched: ReturnType<typeof scryfallToEnrichedCard> }[] = [];
    hand.forEach((c, i) => {
      const scry = cardLookup?.get(c.id);
      if (!scry) return;
      out.push({ handIndex: i, enriched: scryfallToEnrichedCard(scry) });
    });
    return out;
  }, [hand, cardLookup]);

  const previewCards = useMemo(() => previewable.map((p) => p.enriched), [previewable]);
  const previewLabels = useMemo(
    () => previewable.map(() => (isMulliganBottom ? 'Bottom of library' : 'Opening hand')),
    [previewable, isMulliganBottom]
  );
  const previewPages = useMemo(() => previewable.map(() => 1), [previewable]);

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
    (handIndex: number) => {
      const previewIdx = previewable.findIndex((p) => p.handIndex === handIndex);
      if (previewIdx >= 0) setPreviewIndex(previewIdx);
    },
    [previewable]
  );

  function handleCardTap(cardId: string, handIndex: number) {
    if (isMulliganBottom) {
      toggleSelect(cardId);
      return;
    }
    openPreview(handIndex);
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
              your library, in the order you tap them. Long-press to preview.{' '}
              <strong>
                {selected.length}/{requiredBottom} selected
              </strong>
            </p>
          ) : (
            previewable.length > 0 && (
              <p className="playtest-opening-hint">Tap a card to enlarge.</p>
            )
          )}
        </div>

        <div className="playtest-opening-cards" role="list">
          {hand.map((c, i) => {
            const idx = bottomIndex(c.id);
            const isSel = idx !== null;
            const previewable_ = previewable.some((p) => p.handIndex === i);
            const tappable = isMulliganBottom || previewable_;
            return (
              <HandCard
                key={c.id}
                card={c}
                handIndex={i}
                isSelected={isSel}
                selectedOrdinal={idx}
                tappable={tappable}
                isMulliganBottom={isMulliganBottom}
                longPressEnabled={previewable_}
                onTap={handleCardTap}
                onLongPress={openPreview}
              />
            );
          })}
        </div>

        <div className="card-picker-footer playtest-opening-footer">
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

interface HandCardProps {
  card: PlaytestCard;
  handIndex: number;
  isSelected: boolean;
  /** 1-based position in the bottom-of-library selection, or null when not selected. */
  selectedOrdinal: number | null;
  /** False disables the button entirely (no preview, no select). */
  tappable: boolean;
  isMulliganBottom: boolean;
  /** True when a preview is available for this card; gates the long-press handler. */
  longPressEnabled: boolean;
  onTap(cardId: string, handIndex: number): void;
  onLongPress(handIndex: number): void;
}

/**
 * Lifted out of the parent's `hand.map(...)` so each card can call
 * `useLongPress` (a hook with per-instance ref state). Long-press is the only
 * way to preview a card during the mulligan-bottom phase — tap there is
 * reserved for selecting which cards go to the bottom of the library, so a
 * preview gesture would clash with the selection gesture if it were also tap.
 */
function HandCard({
  card,
  handIndex,
  isSelected,
  selectedOrdinal,
  tappable,
  isMulliganBottom,
  longPressEnabled,
  onTap,
  onLongPress,
}: HandCardProps) {
  const longPress = useLongPress({ onLongPress: () => onLongPress(handIndex) });
  const handleClick = () => {
    // Swallow the synthetic click that follows a fired long-press, so a touch
    // user doesn't both preview and select in one gesture.
    if (longPress.consumedClick()) return;
    onTap(card.id, handIndex);
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
      type="button"
      role="listitem"
      className={`playtest-opening-card${isSelected ? ' is-selected' : ''}`}
      style={{ zIndex: handIndex }}
      onClick={handleClick}
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
