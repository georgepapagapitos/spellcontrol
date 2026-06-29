import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
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
  Dices,
  Hand,
  Mountain,
  Play,
  Plus,
  Shuffle,
  Sparkles,
  Sword,
} from 'lucide-react';
import type { ScryfallCard } from '@/deck-builder/types';
import { useDecksStore } from '../../store/decks';
import { useCollapsedPref } from '../../lib/use-collapsed-pref';
import { scryfallToEnrichedCard } from '../../lib/scryfall-to-enriched';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import { useTaggerReady } from '@/lib/use-tagger-ready';
import { COLOR_INFO } from '../../lib/colors';
import { isKeepableHand, simulateOpeningHands, type SimResult } from '../../lib/opening-hand-sim';
import { cardCmc, isLand, toSimCard } from '../../lib/hand-classify';
import { CardPreview } from '../CardPreview';

export interface DeckTestHandPanelHandle {
  reveal(): void;
}

interface Props {
  deckId: string;
  /**
   * Render without the collapsible header chrome (always-open body), for use
   * inside the tabbed analysis surface. The reveal() handle still scrolls into
   * view so feature-strip chips behave.
   */
  embedded?: boolean;
}

const HAND_SIZE = 7;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

export const DeckTestHandPanel = forwardRef<DeckTestHandPanelHandle, Props>(
  function DeckTestHandPanel({ deckId, embedded = false }, ref) {
    const deck = useDecksStore((s) => s.decks.find((d) => d.id === deckId) ?? null);
    const navigate = useNavigate();

    const containerRef = useRef<HTMLDivElement>(null);
    // Measured inner width of the fan scroller, so the hand lays out against the
    // space it actually has (a centered desktop modal, a phone, or an embedded
    // tab) rather than a fixed viewport guess. Drives the spread-vs-overlap math.
    const fanScrollRef = useRef<HTMLDivElement>(null);
    const [fanWidth, setFanWidth] = useState(0);
    // Default to collapsed: test-hand is opt-in — most users don't need a fresh
    // hand on every deck-page load, and the header summary already shows total
    // cards / land count for at-a-glance sanity.
    const [collapsed, setCollapsed] = useCollapsedPref('spellcontrol-test-hand-panel-collapsed');
    // Embedded in a tab: no header chrome, body always open.
    const isCollapsed = embedded ? false : collapsed;

    useImperativeHandle(ref, () => ({
      reveal: () => {
        setCollapsed(false);
        window.requestAnimationFrame(() => {
          containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      },
    }));

    const taggerReady = useTaggerReady();

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

    // The library reduced to simulator inputs. Recomputed when tagger data
    // arrives so ramp classification (which drives keep verdicts) is correct.
    const simLibrary = useMemo(() => library.map(toSimCard), [library, taggerReady]);

    const [hand, setHand] = useState<HandSlot[]>([]);
    const [pile, setPile] = useState<ScryfallCard[]>([]);
    // Monte-Carlo opening-hand stats — auto-run on open (see effect below).
    const [sim, setSim] = useState<SimResult | null>(null);
    const [simulating, setSimulating] = useState(false);
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

    const handleSimulate = () => {
      setSimulating(true);
      // Defer one frame so the button's "Simulating…" label paints before the
      // (brief, synchronous) Monte-Carlo run occupies the main thread. 1,000
      // hands of a ~100-card shuffle runs well under one frame even on phones.
      window.requestAnimationFrame(() => {
        setSim(simulateOpeningHands(simLibrary, { iterations: 1000 }));
        setSimulating(false);
      });
    };

    // Measure the fan scroller so the hand can spread to fill the space it has
    // (and only tuck into an overlap when genuinely crowded). ResizeObserver
    // fires on observe, so the first real width lands almost immediately;
    // re-attaches when the deck goes from empty to populated (totalCards dep).
    useLayoutEffect(() => {
      const el = fanScrollRef.current;
      if (!el) return;
      const ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width;
        if (w != null) setFanWidth(w);
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, [totalCards]);

    // Odds are this surface's reason to exist, so they're always on: auto-run
    // the simulation on open and whenever the deck shape or tagger
    // classification (simLibrary) changes. The button below just re-samples.
    // The run is deferred a frame (and all state-setting lives in that
    // callback) so the effect body never synchronously sets state — it's
    // instant in practice, so no "Simulating…" interstitial is needed here.
    useEffect(() => {
      if (totalCards === 0) return;
      const id = window.requestAnimationFrame(() => {
        setSim(simulateOpeningHands(simLibrary, { iterations: 1000 }));
      });
      return () => window.cancelAnimationFrame(id);
    }, [simLibrary, totalCards]);

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

    // ── Responsive fan layout ──────────────────────────────────────────────
    // Lay the hand out against the measured space. When the cards fit, they sit
    // side-by-side with a real gap (readable, no overlap, no scroll); when
    // crowded (narrow screen, or many cards after Draw) the step shrinks and
    // they tuck into the classic overlap fan, the last card always fully
    // visible. Only when even the tightest step would overflow do we fall back
    // to horizontal scroll. `marginLeft` is applied uniformly to every card and
    // compensated by the container's paddingLeft, so a card never jumps as it
    // crosses the index-0 boundary mid-drag.
    const CARD_MIN = 72; // px — smallest readable card (phones)
    const CARD_MAX = 148; // px — largest before 7 cards look comical on desktop
    const SPREAD_GAP = 10; // px — gap between cards when they fit
    const MIN_STEP = 24; // px — tightest tuck before we allow scroll
    const containerW = fanWidth || 560; // fallback until the observer measures
    const cardWidthPx = Math.min(CARD_MAX, Math.max(CARD_MIN, containerW / 7.8));
    const fitStep = cardWidthPx + SPREAD_GAP;
    const compressStep = hand.length > 1 ? (containerW - cardWidthPx) / (hand.length - 1) : fitStep;
    const stepPx = Math.max(MIN_STEP, Math.min(fitStep, compressStep));
    const marginLeftPx = stepPx - cardWidthPx; // negative = overlap, positive = gap
    const padLeftPx = Math.max(0, -marginLeftPx);

    const canDraw = pile.length > 0;
    const empty = totalCards === 0;
    const breakdown = useMemo(() => summarizeHand(hand), [hand, taggerReady]);

    // Single-hand verdict. Post-Draw hands (>7 cards) don't fire a verdict —
    // those would always look keepable. The keep heuristic itself lives in
    // `isKeepableHand`, shared with the simulator so the dealt-hand chip and
    // the simulated rate can never use different rules.
    const isKeepable =
      hand.length >= HAND_SIZE && isKeepableHand(hand.map((s) => toSimCard(s.card)));

    const slotIds = useMemo(() => hand.map((s) => s.id), [hand]);

    return (
      <div
        ref={containerRef}
        className={`deck-test-hand-panel${isCollapsed ? ' is-collapsed' : ''}${embedded ? ' is-embedded' : ''}`}
        role="region"
        aria-label="Test hand"
      >
        {!embedded && (
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
              {collapsed ? (
                <ChevronDown width={16} height={16} />
              ) : (
                <ChevronUp width={16} height={16} />
              )}
            </span>
          </button>
        )}

        <div
          id="deck-test-hand-body"
          className="deck-test-hand-body"
          hidden={isCollapsed}
          aria-hidden={isCollapsed}
        >
          {empty ? (
            <p className="deck-test-hand-empty">Add cards to the deck to draw a test hand.</p>
          ) : (
            <>
              <div className="deck-test-hand-fan-scroll" ref={fanScrollRef}>
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
                      style={{ paddingLeft: `${padLeftPx}px` }}
                    >
                      {hand.map((slot, i) => (
                        <SortableCard
                          key={slot.id}
                          slot={slot}
                          index={i}
                          marginLeftPx={marginLeftPx}
                          cardWidthPx={cardWidthPx}
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
                <button
                  type="button"
                  className="deck-test-hand-action deck-test-hand-action-bridge"
                  onClick={() => navigate(`/decks/${deckId}/playtest`)}
                  title="Open the full playtest board — mulligan, draw turn by turn, track the game"
                >
                  <Play width={14} height={14} aria-hidden /> Play this out
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
                {hand.length > HAND_SIZE && <> · After {hand.length - HAND_SIZE} draws</>}
              </p>

              <section className="deck-test-hand-sim" aria-label="Opening hand simulation">
                <div className="deck-test-hand-sim-bar">
                  <span className="deck-test-hand-sim-heading">
                    Opening-hand odds
                    <span className="deck-test-hand-sim-heading-sub">across 1,000 shuffles</span>
                  </span>
                  <button
                    type="button"
                    className="deck-test-hand-action deck-test-hand-sim-run"
                    onClick={handleSimulate}
                    disabled={simulating}
                    title="Re-sample — deal a fresh 1,000 hands"
                  >
                    <Dices width={14} height={14} aria-hidden />
                    {simulating ? 'Simulating…' : 'Re-run'}
                  </button>
                </div>

                {sim && (
                  <div className="deck-test-hand-sim-report">
                    <ul className="deck-test-hand-sim-stats" aria-label="Simulation results">
                      <SimStat label="Keepable" value={sim.keepableRate} tone="good" />
                      <SimStat
                        label="After a mull"
                        value={sim.keepableWithinMulligansRate}
                        tone="good"
                      />
                      <SimStat label="Has ramp" value={sim.rampRate} />
                      <SimStat label="Mana screw" value={sim.screwRate} tone="warn" />
                      <SimStat label="Mana flood" value={sim.floodRate} tone="warn" />
                    </ul>
                    <LandHistogram result={sim} />
                    <p className="deck-test-hand-stat-secondary">
                      Lands per opening hand across {sim.iterations.toLocaleString()} simulated
                      draws · avg <strong>{sim.avgLands.toFixed(2)}</strong>
                    </p>
                  </div>
                )}

                {/* Focus stays on the run button (likely re-run); this polite
                    live region is how a screen-reader user learns the result. */}
                <p className="sr-only" role="status">
                  {sim
                    ? `Simulated ${sim.iterations.toLocaleString()} opening hands. ` +
                      `${Math.round(sim.keepableRate * 100)} percent keepable, ` +
                      `${Math.round(sim.keepableWithinMulligansRate * 100)} percent after a mulligan. ` +
                      `Average ${sim.avgLands.toFixed(1)} lands.`
                    : ''}
                </p>
              </section>
            </>
          )}
        </div>

        {previewIndex !== null && previewCards[previewIndex] && (
          <CardPreview
            source="playtest"
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
);

interface SortableCardProps {
  slot: HandSlot;
  index: number;
  /** Per-card left margin in px: negative tucks cards into an overlap fan,
   *  positive spreads them with a gap. Uniform across cards (see fan layout). */
  marginLeftPx: number;
  /** Measured card width in px, so the hand scales to the surface it's in. */
  cardWidthPx: number;
  isNewlyDrawn: boolean;
  onPreview: () => void;
}

function SortableCard({
  slot,
  index,
  marginLeftPx,
  cardWidthPx,
  isNewlyDrawn,
  onPreview,
}: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slot.id,
  });

  const url = cardImage(slot.card);

  return (
    <li
      ref={setNodeRef}
      className={`deck-test-hand-card${isDragging ? ' is-dragging' : ''}`}
      style={{
        width: `${cardWidthPx}px`,
        // Uniform pull so every card overlaps the previous one by the same
        // amount. The container offsets this with paddingLeft so the first
        // card ends up flush — avoids index-0 layout jumps during drags.
        marginLeft: `${marginLeftPx}px`,
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
      <span className={`deck-test-hand-card-art${isNewlyDrawn ? ' is-newly-drawn' : ''}`}>
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

// ── Simulation report ──────────────────────────────────────────────────────

function SimStat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'warn' }) {
  return (
    <li className={`deck-test-hand-sim-stat${tone ? ` is-${tone}` : ''}`}>
      <strong>{Math.round(value * 100)}%</strong>
      <span className="deck-test-hand-sim-stat-label">{label}</span>
    </li>
  );
}

function LandHistogram({ result }: { result: SimResult }) {
  // Reuses the stats panel's `.deck-curve` chart. Bar height is the share of
  // hands with that many lands; each bar is split into WUBRG segments by the
  // colour identity of the lands actually drawn — same treatment, and same
  // `COLOR_INFO` pip colours, as the mana curve chart.
  const max = Math.max(1, ...result.landHistogram);
  const order = ['W', 'U', 'B', 'R', 'G', 'C'];
  return (
    <div
      className="deck-curve deck-test-hand-sim-curve"
      role="img"
      aria-label="Distribution of lands in the opening hand, coloured by land colour identity"
    >
      {result.landHistogram.map((count, lands) => {
        const pct = result.iterations > 0 ? (count / result.iterations) * 100 : 0;
        const byColor = result.landColorByCount[lands] ?? {};
        const totalShares = Object.values(byColor).reduce((s, n) => s + n, 0);
        const segments = order.map((k) => ({ k, n: byColor[k] ?? 0 })).filter((s) => s.n > 0);
        return (
          <div key={lands} className="deck-curve-col">
            <div
              className="deck-curve-bar"
              style={{ height: `${(count / max) * 100}%` }}
              title={`${lands} ${lands === 1 ? 'land' : 'lands'}: ${pct.toFixed(1)}% of hands`}
            >
              {segments.map((s) => (
                <div
                  key={s.k}
                  className="deck-curve-bar-seg"
                  style={{
                    height: `${(s.n / totalShares) * 100}%`,
                    background: COLOR_INFO[s.k]?.pip ?? 'var(--accent)',
                  }}
                />
              ))}
            </div>
            <div className="deck-curve-label">{lands}</div>
            <div className="deck-curve-count">{Math.round(pct)}%</div>
            <span className="sr-only">
              {lands} {lands === 1 ? 'land' : 'lands'}: {pct.toFixed(1)} percent of hands
            </span>
          </div>
        );
      })}
    </div>
  );
}
