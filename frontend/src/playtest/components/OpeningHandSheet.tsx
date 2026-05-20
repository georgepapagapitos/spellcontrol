import { useMemo, useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import type { PlaytestCard } from '@/lib/playtest';
import type { ScryfallCard } from '@/deck-builder/types';
import { scryfallToEnrichedCard } from '@/lib/scryfall-to-enriched';
import { CardPreview } from '@/components/CardPreview';
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
    [previewable, isMulliganBottom],
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

  function handleCardClick(cardId: string, handIndex: number) {
    if (isMulliganBottom) {
      toggleSelect(cardId);
      return;
    }
    // Opening phase — tap to enlarge in the carousel.
    const previewIdx = previewable.findIndex((p) => p.handIndex === handIndex);
    if (previewIdx >= 0) setPreviewIndex(previewIdx);
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
        <div className="card-picker-handle" aria-hidden />
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
              Choose {requiredBottom} card{requiredBottom === 1 ? '' : 's'} to send to the bottom
              of your library, in the order you tap them.{' '}
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
            const tappable = isMulliganBottom || previewable.some((p) => p.handIndex === i);
            return (
              <button
                key={c.id}
                type="button"
                role="listitem"
                className={`playtest-opening-card${isSel ? ' is-selected' : ''}`}
                style={{ zIndex: i }}
                onClick={() => handleCardClick(c.id, i)}
                aria-pressed={isMulliganBottom ? isSel : undefined}
                aria-label={`${c.name}${isSel ? ` — selected, position ${idx}` : ''}`}
                disabled={!tappable}
              >
                {c.imageUrl ? (
                  <img src={c.imageUrl} alt="" draggable={false} />
                ) : (
                  <span className="playtest-opening-cardName">{c.name}</span>
                )}
                {idx != null && (
                  <span className="playtest-opening-cardBadge" aria-hidden>
                    {idx}
                  </span>
                )}
              </button>
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
