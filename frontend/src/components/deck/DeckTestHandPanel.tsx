import { useEffect, useMemo, useState } from 'react';
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
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Hand,
  Mountain,
  Plus,
  Shuffle,
  Sparkles,
  Sword,
} from 'lucide-react';
import type { ScryfallCard } from '@/deck-builder/types';
import { useDecksStore } from '../../store/decks';
import { scryfallToEnrichedCard } from '../../lib/scryfall-to-enriched';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import { CardPreview } from '../CardPreview';

interface Props {
  deckId: string;
}

const HAND_SIZE = 7;
const COLLAPSED_STORAGE_KEY = 'spellcontrol-test-hand-panel-collapsed';

function readCollapsedPref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsedPref(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isLand(card: ScryfallCard): boolean {
  const tl = card.type_line ?? card.card_faces?.[0]?.type_line ?? '';
  return tl.toLowerCase().includes('land');
}

function cardCmc(card: ScryfallCard): number {
  return card.cmc ?? 0;
}

interface HandBreakdown {
  lands: number;
  ramp: number;
  removal: number;
  cardDraw: number;
  /** Average mana value of non-land spells in the hand. NaN when no spells. */
  avgSpellCmc: number;
}

function summarizeHand(hand: Array<{ card: ScryfallCard }>): HandBreakdown {
  let lands = 0;
  let ramp = 0;
  let removal = 0;
  let cardDraw = 0;
  let spellCmcSum = 0;
  let spellCount = 0;
  for (const { card } of hand) {
    if (isLand(card)) {
      lands += 1;
      continue;
    }
    spellCount += 1;
    spellCmcSum += cardCmc(card);
    const role = getCardRole(card.name);
    if (role === 'ramp') ramp += 1;
    else if (role === 'removal' || role === 'boardwipe') removal += 1;
    else if (role === 'cardDraw') cardDraw += 1;
  }
  return {
    lands,
    ramp,
    removal,
    cardDraw,
    avgSpellCmc: spellCount > 0 ? spellCmcSum / spellCount : NaN,
  };
}

function cardImage(card: ScryfallCard): string | undefined {
  return (
    card.image_uris?.normal ??
    card.image_uris?.small ??
    card.card_faces?.[0]?.image_uris?.normal ??
    card.card_faces?.[0]?.image_uris?.small
  );
}

/**
 * Each hand slot carries a stable id independent of the card it holds, so
 * @dnd-kit can identify slots across reorders without remounting them.
 */
interface HandSlot {
  id: string;
  card: ScryfallCard;
}

let slotCounter = 0;
function makeSlot(card: ScryfallCard): HandSlot {
  slotCounter += 1;
  return { id: `slot-${slotCounter}`, card };
}

export function DeckTestHandPanel({ deckId }: Props) {
  const deck = useDecksStore((s) => s.decks.find((d) => d.id === deckId) ?? null);

  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsedPref());
  useEffect(() => writeCollapsedPref(collapsed), [collapsed]);

  // The library — every card slot in the mainboard, using the EXACT
  // ScryfallCard the user chose for that slot (so printings/sets/art are
  // preserved through the shuffle). `deck.cards` is already one entry per
  // physical slot — duplicates like 4× Sol Ring appear four times, basics
  // appear once per copy. Excludes:
  //   - commander / partner commander (start in the command zone, never the
  //     library)
  //   - sideboard (never in the library during a game)
  const library = useMemo(() => {
    if (!deck) return [] as ScryfallCard[];
    return deck.cards.map((c) => c.card);
  }, [deck]);

  const totalCards = library.length;
  const landCount = useMemo(() => library.filter(isLand).length, [library]);
  const avgLandsInOpeningHand =
    totalCards > 0 ? ((landCount / totalCards) * HAND_SIZE).toFixed(2) : '0.00';

  const [hand, setHand] = useState<HandSlot[]>([]);
  const [pile, setPile] = useState<ScryfallCard[]>([]);
  // Render-phase reset: deal on first mount AND whenever the deck shape
  // changes. Sentinel ensures the first render mismatches the real key so
  // the user always sees an opening hand without clicking Deal.
  const dealKey = `${deckId}:${totalCards}`;
  const [trackedDealKey, setTrackedDealKey] = useState<string>('__uninitialized__');
  if (trackedDealKey !== dealKey) {
    setTrackedDealKey(dealKey);
    const shuffled = shuffle(library);
    setHand(shuffled.slice(0, HAND_SIZE).map(makeSlot));
    setPile(shuffled.slice(HAND_SIZE));
  }

  // The most-recently-drawn slot id. Only this card plays the slide-in
  // entrance — initial-deal cards just appear, and reorders never animate
  // opacity. That mirrors the reference and avoids the spurious fade-in we
  // saw whenever any animation property mutated during a reorder.
  const [drawnSlotId, setDrawnSlotId] = useState<string | null>(null);

  const handleDeal = () => {
    const shuffled = shuffle(library);
    setHand(shuffled.slice(0, HAND_SIZE).map(makeSlot));
    setPile(shuffled.slice(HAND_SIZE));
    setDrawnSlotId(null);
  };

  const handleDraw = () => {
    setPile((p) => {
      if (p.length === 0) return p;
      const [next, ...rest] = p;
      const slot = makeSlot(next);
      setHand((h) => [...h, slot]);
      setDrawnSlotId(slot.id);
      return rest;
    });
  };

  // ── Drag-reorder via @dnd-kit ──────────────────────────────────────────
  // PointerSensor's `distance: 6` activation constraint distinguishes clicks
  // (open preview) from drags (reorder). KeyboardSensor enables Tab → Space
  // → Arrows reordering for free, with screen-reader announcements.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setHand((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === active.id);
      const newIndex = prev.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  // ── Preview wiring ──────────────────────────────────────────────────
  // CardPreview wants EnrichedCard[]; convert lazily and feed the full hand
  // so prev/next swipes through every card.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const previewCards = useMemo(
    () => hand.map((slot) => scryfallToEnrichedCard(slot.card)),
    [hand]
  );
  const previewSectionLabels = useMemo(() => hand.map(() => 'Test hand'), [hand]);
  const previewPageNumbers = useMemo(() => hand.map(() => 1), [hand]);

  // Dynamic overlap so 8+ cards (after Draw) still fit. Mirrors the
  // reference's formula: grows ~0.35rem per extra card, capped so the cards
  // never reverse direction.
  const overlapRem =
    hand.length <= HAND_SIZE
      ? 1.5
      : Math.min(1.5 + (hand.length - HAND_SIZE) * 0.35, 5.5);

  const canDraw = pile.length > 0;
  const empty = totalCards === 0;
  const breakdown = useMemo(() => summarizeHand(hand), [hand]);

  // "Keepable" heuristic. Treats ramp (mana dorks + rocks + cost reducers)
  // as land-equivalent because they functionally accelerate your mana the
  // same way an extra land does — a hand of "1 land + 2 mana rocks + a real
  // play" is a clear keep, but the naive "2-4 lands" rule would mulligan it.
  //
  // Three rules, all must hold:
  //   1. We're looking at a full 7-card hand (post-Draw counts don't fire a
  //      verdict — those would always look keepable).
  //   2. Effective mana sources (lands + ramp) is 2-4: not screwed, not
  //      flooded.
  //   3. At least one playable spell at CMC ≤ 3 — something to do in the
  //      first three turns.
  const effectiveLands = breakdown.lands + breakdown.ramp;
  const isKeepable =
    hand.length >= HAND_SIZE &&
    effectiveLands >= 2 &&
    effectiveLands <= 4 &&
    hand.some((s) => !isLand(s.card) && cardCmc(s.card) <= 3);

  const slotIds = useMemo(() => hand.map((s) => s.id), [hand]);

  return (
    <div
      className={`deck-test-hand-panel${collapsed ? ' is-collapsed' : ''}`}
      role="region"
      aria-label="Test hand"
    >
      <button
        type="button"
        className="deck-test-hand-header"
        aria-expanded={!collapsed}
        aria-controls="deck-test-hand-body"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Expand test hand' : 'Collapse test hand'}
      >
        <Hand width={16} height={16} aria-hidden />
        <span className="deck-test-hand-title">Test hand</span>
        <span className="deck-test-hand-header-summary" aria-hidden>
          {empty ? (
            <span className="deck-test-hand-header-empty">Empty deck</span>
          ) : (
            <>
              <span>{totalCards} cards</span>
              <span>
                {landCount} {landCount === 1 ? 'land' : 'lands'}
              </span>
            </>
          )}
        </span>
        <span className="deck-test-hand-header-chevron" aria-hidden>
          {collapsed ? <ChevronDown width={16} height={16} /> : <ChevronUp width={16} height={16} />}
        </span>
      </button>

      <div
        id="deck-test-hand-body"
        className="deck-test-hand-body"
        hidden={collapsed}
        aria-hidden={collapsed}
      >
        {empty ? (
          <p className="deck-test-hand-empty">Add cards to the deck to draw a test hand.</p>
        ) : (
          <>
            <div className="deck-test-hand-fan-scroll">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
                /* Constrain drag to the row's horizontal axis. Vertical
                   movement would visually break the fan layout (cards
                   could lift out of the row's flow), and we already have
                   the lift-on-drag visual baked in via CSS — the user
                   never needs to drag up. restrictToParentElement keeps
                   the dragged card from leaving the panel, which is
                   especially important for the rightward overflow case
                   after Draw. */
                modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
              >
                <SortableContext items={slotIds} strategy={horizontalListSortingStrategy}>
                  <ul
                    className="deck-test-hand-fan"
                    role="list"
                    aria-label="Opening hand — drag to reorder, click to preview"
                    /* The container compensates for every card's left-pull
                       overlap so the first card lands flush with the panel.
                       Keeping the per-card margin uniform (vs. zeroing it on
                       index 0) means a card never visually jumps when it
                       crosses the index-0 boundary during a drag. */
                    style={{ paddingLeft: `${overlapRem}rem` }}
                  >
                    {hand.map((slot, i) => (
                      <SortableCard
                        key={slot.id}
                        slot={slot}
                        index={i}
                        overlapRem={overlapRem}
                        isNewlyDrawn={slot.id === drawnSlotId}
                        onPreview={() => setPreviewIndex(i)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            </div>

            <div className="deck-test-hand-actions">
              <button
                type="button"
                className="deck-test-hand-action"
                onClick={handleDraw}
                disabled={!canDraw}
                title={canDraw ? 'Draw one more card from the library' : 'Library is empty'}
              >
                <Plus width={14} height={14} aria-hidden /> Draw
              </button>
              <button
                type="button"
                className="deck-test-hand-action is-primary"
                onClick={handleDeal}
                title="Reshuffle and deal a fresh opening hand"
              >
                <Shuffle width={14} height={14} aria-hidden /> Deal another hand
              </button>
            </div>

            <ul className="deck-test-hand-chips" aria-label="Hand breakdown">
              <li className="deck-test-hand-chip">
                <Mountain width={12} height={12} aria-hidden />
                <strong>{breakdown.lands}</strong>{' '}
                <span className="deck-test-hand-chip-label">
                  {breakdown.lands === 1 ? 'land' : 'lands'}
                </span>
              </li>
              <li className="deck-test-hand-chip">
                <Sparkles width={12} height={12} aria-hidden />
                <strong>{breakdown.ramp}</strong>{' '}
                <span className="deck-test-hand-chip-label">ramp</span>
              </li>
              <li className="deck-test-hand-chip">
                <Sword width={12} height={12} aria-hidden />
                <strong>{breakdown.removal}</strong>{' '}
                <span className="deck-test-hand-chip-label">removal</span>
              </li>
              <li className="deck-test-hand-chip">
                <BookOpen width={12} height={12} aria-hidden />
                <strong>{breakdown.cardDraw}</strong>{' '}
                <span className="deck-test-hand-chip-label">draw</span>
              </li>
              {Number.isFinite(breakdown.avgSpellCmc) && (
                <li className="deck-test-hand-chip">
                  <span className="deck-test-hand-chip-cmc-icon" aria-hidden>
                    {'{'}
                    {breakdown.avgSpellCmc.toFixed(1)}
                    {'}'}
                  </span>
                  <span className="deck-test-hand-chip-label">avg spell</span>
                </li>
              )}
              {hand.length >= HAND_SIZE && (
                <li
                  className={`deck-test-hand-chip is-verdict ${isKeepable ? 'is-keepable' : 'is-mulligan'}`}
                >
                  <strong>{isKeepable ? 'Keepable' : 'Mulligan?'}</strong>
                </li>
              )}
            </ul>
            <p className="deck-test-hand-stat-secondary">
              Avg lands in opening hand: <strong>{avgLandsInOpeningHand}</strong>
              {hand.length > HAND_SIZE && (
                <> · After {hand.length - HAND_SIZE} draws</>
              )}
            </p>
          </>
        )}
      </div>

      {previewIndex !== null && previewCards[previewIndex] && (
        <CardPreview
          cards={previewCards}
          index={previewIndex}
          binderName="Test hand"
          sectionLabels={previewSectionLabels}
          pageNumbers={previewPageNumbers}
          totalPages={1}
          currentDeckId={deckId}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
}

interface SortableCardProps {
  slot: HandSlot;
  index: number;
  overlapRem: number;
  isNewlyDrawn: boolean;
  onPreview: () => void;
}

function SortableCard({ slot, index, overlapRem, isNewlyDrawn, onPreview }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slot.id,
  });

  const url = cardImage(slot.card);

  return (
    <li
      ref={setNodeRef}
      className={`deck-test-hand-card${isDragging ? ' is-dragging' : ''}`}
      style={{
        // Uniform pull so every card overlaps the previous one by the same
        // amount. The container offsets this with paddingLeft so the first
        // card ends up flush — avoids index-0 layout jumps during drags.
        marginLeft: `-${overlapRem}rem`,
        zIndex: isDragging ? 50 : index,
        // No `animationDelay` here on purpose — when cards reorder, their
        // index changes and updating animationDelay would re-trigger the
        // deck-test-hand-in keyframe (fill-mode: both restarts on delay
        // change), producing a spurious fade-in on every shifted card.
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: 'none',
      }}
      // Click fires when PointerSensor's distance constraint isn't crossed
      // (i.e. the user tapped without dragging) — open preview.
      onClick={onPreview}
      {...attributes}
      {...listeners}
    >
      <span
        className={`deck-test-hand-card-art${isNewlyDrawn ? ' is-newly-drawn' : ''}`}
      >
        {url ? (
          <img src={url} alt={slot.card.name} loading="lazy" decoding="async" draggable={false} />
        ) : (
          <span className="deck-test-hand-card-art-fallback" aria-hidden />
        )}
      </span>
      <span className="sr-only">{slot.card.name}</span>
    </li>
  );
}
