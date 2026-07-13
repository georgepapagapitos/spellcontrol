import { useEffect, useMemo, useRef, useState } from 'react';
import './PlaytestStatsSheet.css';
import { Hourglass, Loader2 } from 'lucide-react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { isOpponentDefeated, type PlaytestState } from '@/lib/playtest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '@/store/decks';
import {
  computeHandStats,
  computeBattlefieldStats,
  computeDeckStats,
  toHandSimCards,
  medianActualKillTurn,
} from '@/lib/playtest-stats';
import {
  isKeepableHand,
  simulateAssemblyClock,
  simulateLandDropCurve,
  simulateOpeningHands,
  type AssemblyClockResult,
  type LandDropCurveResult,
} from '@/lib/opening-hand-sim';
import { toSimCard } from '@/lib/hand-classify';
import { loadSessionHistory } from '@/lib/playtest/session-history';
import { computeSessionAggregates, MIN_SESSIONS_FOR_STATS } from '@/lib/playtest/session-record';
import { MeterBar, StackedBar } from '@/components/shared/MeterBar';
import { ColorPip, TypeIcon } from '@/components/shared/ManaSymbol';
import { Tabs, type TabItem } from '@/components/Tabs';
import { InfoTip } from '@/components/InfoTip';
import { assemblyClockTip } from '@/components/deck/WinConditionPanel';

// ── Types ─────────────────────────────────────────────────────────────────────

type StatsTab = 'hand' | 'battlefield' | 'deck' | 'simulate' | 'history';

interface Props {
  state: PlaytestState;
  deck: Deck | undefined;
  cardLookup: Map<string, ScryfallCard> | undefined;
  mulliganCount: number;
  onClose(): void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: Array<TabItem<StatsTab>> = [
  { id: 'hand', label: 'Hand' },
  { id: 'battlefield', label: 'Battlefield' },
  { id: 'deck', label: 'Session' },
  { id: 'simulate', label: 'Simulate' },
  { id: 'history', label: 'History' },
];

const CMC_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7+'];
const TYPE_ORDER = ['creature', 'artifact', 'enchantment', 'planeswalker', 'land', 'other'];
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'C'];

// ── Sub-sections ──────────────────────────────────────────────────────────────

function HandStatsSection({
  state,
  cardLookup,
}: {
  state: PlaytestState;
  cardLookup: Map<string, ScryfallCard> | undefined;
}) {
  const hand = state.zones.hand;

  const stats = useMemo(() => computeHandStats(hand, cardLookup), [hand, cardLookup]);

  const keepable = useMemo(() => {
    if (hand.length === 0) return null;
    const simCards = toHandSimCards(hand, cardLookup);
    return isKeepableHand(simCards);
  }, [hand, cardLookup]);

  if (hand.length === 0) {
    return (
      <p className="playtest-stats-empty">Your hand is empty — draw cards to see hand stats.</p>
    );
  }

  const maxCmcBucket = Math.max(...stats.cmcBuckets, 1);

  return (
    <div className="playtest-stats-rows">
      {/* Land / spell count + stacked bar */}
      <div className="playtest-stats-row">
        <span className="playtest-stats-row__label">Lands</span>
        <span className="playtest-stats-row__value">{stats.lands}</span>
        <StackedBar
          className="playtest-stats-row__bar"
          segments={[
            {
              key: 'lands',
              value: stats.lands,
              color: 'var(--mtg-g)',
              title: `${stats.lands} land${stats.lands === 1 ? '' : 's'}`,
            },
            {
              key: 'spells',
              value: stats.nonLands,
              color: 'var(--accent)',
              title: `${stats.nonLands} spell${stats.nonLands === 1 ? '' : 's'}`,
            },
          ]}
          max={hand.length}
        />
        <span className="playtest-stats-row__value">{stats.nonLands}</span>
        <span className="playtest-stats-row__label" style={{ minWidth: 'auto' }}>
          Spells
        </span>
      </div>

      {/* Keep verdict */}
      {keepable !== null && (
        <div className="playtest-stats-row">
          <span className="playtest-stats-row__label">Verdict</span>
          <span
            className={`playtest-stats-verdict ${
              keepable ? 'playtest-stats-verdict--keep' : 'playtest-stats-verdict--mulligan'
            }`}
          >
            {keepable ? 'Keepable' : 'Consider mulliganing'}
          </span>
        </div>
      )}

      {/* Color breakdown */}
      {Object.keys(stats.colorBreakdown).length > 0 && (
        <div className="playtest-stats-row" style={{ alignItems: 'flex-start' }}>
          <span className="playtest-stats-row__label">Land colors</span>
          <div className="playtest-stats-colors" aria-label="Land color breakdown">
            {COLOR_ORDER.filter((c) => stats.colorBreakdown[c]).map((color) => (
              <span key={color} className="playtest-stats-color-item">
                <ColorPip color={color} aria-hidden />
                <span>{stats.colorBreakdown[color]}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* CMC histogram */}
      {stats.nonLands > 0 && (
        <>
          <p className="playtest-stats-section-title" style={{ marginTop: '0.5rem' }}>
            Spell CMC
          </p>
          <div className="playtest-stats-histogram" aria-label="CMC distribution">
            {CMC_LABELS.map((label, i) =>
              stats.cmcBuckets[i] > 0 ? (
                <div key={label} className="playtest-stats-histogram__row">
                  <span className="playtest-stats-histogram__bucket" aria-hidden>
                    {label}
                  </span>
                  <MeterBar
                    value={stats.cmcBuckets[i]}
                    max={maxCmcBucket}
                    color="var(--accent)"
                    className="playtest-stats-histogram__bar"
                  />
                  <span className="playtest-stats-histogram__count">{stats.cmcBuckets[i]}</span>
                </div>
              ) : null
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BattlefieldStatsSection({ state }: { state: PlaytestState }) {
  const bf = state.battlefield;

  const stats = useMemo(() => computeBattlefieldStats(bf), [bf]);

  const hasPermanents =
    Object.values(stats.permanentsByType).some((v) => v > 0) || stats.tokenCount > 0;

  if (!hasPermanents) {
    return <p className="playtest-stats-empty">No permanents on the battlefield yet.</p>;
  }

  const totalPermanents = Object.values(stats.permanentsByType).reduce((a, b) => a + b, 0);

  return (
    <div className="playtest-stats-rows">
      {/* Permanents by type */}
      {TYPE_ORDER.filter((t) => stats.permanentsByType[t] > 0).map((type) => (
        <div key={type} className="playtest-stats-type-row">
          <span className="playtest-stats-type-row__icon" aria-hidden>
            <TypeIcon type={type} />
          </span>
          <span className="playtest-stats-type-row__label">{type}s</span>
          <span className="playtest-stats-type-row__count">{stats.permanentsByType[type]}</span>
        </div>
      ))}

      {stats.tokenCount > 0 && (
        <div className="playtest-stats-type-row">
          <span className="playtest-stats-type-row__icon" aria-hidden>
            ✦
          </span>
          <span className="playtest-stats-type-row__label">Tokens</span>
          <span className="playtest-stats-type-row__count">{stats.tokenCount}</span>
        </div>
      )}

      <hr className="playtest-stats-divider" />

      {/* Tapped / untapped */}
      {totalPermanents + stats.tokenCount > 0 && (
        <div className="playtest-stats-row">
          <span className="playtest-stats-row__label">Tapped</span>
          <span className="playtest-stats-row__value">{stats.tapped}</span>
          <StackedBar
            className="playtest-stats-row__bar"
            segments={[
              {
                key: 'tapped',
                value: stats.tapped,
                color: 'var(--text-secondary)',
                title: `${stats.tapped} tapped`,
              },
              {
                key: 'untapped',
                value: stats.untapped,
                color: 'var(--accent)',
                title: `${stats.untapped} untapped`,
              },
            ]}
          />
          <span className="playtest-stats-row__value">{stats.untapped}</span>
          <span className="playtest-stats-row__label" style={{ minWidth: 'auto' }}>
            Untapped
          </span>
        </div>
      )}

      {/* Avg CMC */}
      {stats.avgCmc > 0 && (
        <div className="playtest-stats-row">
          <span className="playtest-stats-row__label">Avg CMC</span>
          <span className="playtest-stats-row__value">{stats.avgCmc.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}

function DeckStatsSection({
  state,
  deck,
  mulliganCount,
}: {
  state: PlaytestState;
  deck: Deck | undefined;
  mulliganCount: number;
}) {
  const deckSize = deck ? deck.cards.length : null;

  const sessionStats = useMemo(
    () => computeDeckStats(state, deckSize, mulliganCount),
    [state, deckSize, mulliganCount]
  );

  // Run Monte-Carlo simulation against the original deck list (stable context stat).
  // Fixed seed=42 → deterministic. Memoized on deck id + card count so the expensive
  // 500-iteration run only re-fires when the deck actually changes.
  const simResult = useMemo(() => {
    if (!deck || deck.cards.length < 7) return null;
    const simCards = deck.cards.map((slot) => toSimCard(slot.card));
    return simulateOpeningHands(simCards, { iterations: 500, seed: 42 });
  }, [deck?.id, deck?.cards.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const defeatedCount = state.opponents.filter((o) =>
    isOpponentDefeated(o, state.commanderDamageThreshold)
  ).length;

  return (
    <div className="playtest-stats-rows">
      {/* Life / commander damage (E138) — the goldfish payoff: what turn do I win. */}
      <div className="playtest-stats-row">
        <span className="playtest-stats-row__label">You</span>
        <span className="playtest-stats-row__value">{state.life} life</span>
      </div>
      {state.opponents.map((o, i) => (
        <div key={i} className="playtest-stats-row">
          <span className="playtest-stats-row__label">
            {state.opponents.length > 1 ? `Opponent ${i + 1}` : 'Opponent'}
          </span>
          <span className="playtest-stats-row__value">
            {o.life} life
            {o.commanderDamage > 0 ? ` · ${o.commanderDamage} cmdr dmg` : ''}
            {isOpponentDefeated(o, state.commanderDamageThreshold) ? ' · defeated' : ''}
          </span>
        </div>
      ))}
      {state.opponents.length > 1 && (
        <div className="playtest-stats-row">
          <span className="playtest-stats-row__label">Defeated</span>
          <span className="playtest-stats-row__value">
            {defeatedCount} / {state.opponents.length}
          </span>
        </div>
      )}
      {state.tableDefeatedTurn !== null && (
        <div className="playtest-stats-row">
          <span className="playtest-stats-row__label">Table defeated</span>
          <span className="playtest-stats-verdict playtest-stats-verdict--keep">
            Turn {state.tableDefeatedTurn}
          </span>
        </div>
      )}
      <hr className="playtest-stats-divider" />

      {/* Session info */}
      <div className="playtest-stats-row">
        <span className="playtest-stats-row__label">Turn</span>
        <span className="playtest-stats-row__value">{sessionStats.turn}</span>
      </div>
      <div className="playtest-stats-row">
        <span className="playtest-stats-row__label">Hand size</span>
        <span className="playtest-stats-row__value">{sessionStats.handSize}</span>
      </div>
      {sessionStats.mulliganCount > 0 && (
        <div className="playtest-stats-row">
          <span className="playtest-stats-row__label">Mulligans</span>
          <span className="playtest-stats-row__value">{sessionStats.mulliganCount}</span>
        </div>
      )}
      {sessionStats.cardsDrawn !== null && (
        <div className="playtest-stats-row">
          <span className="playtest-stats-row__label">Cards drawn</span>
          <span className="playtest-stats-row__value">{sessionStats.cardsDrawn}</span>
        </div>
      )}

      {/* Zone sizes */}
      <p className="playtest-stats-section-title" style={{ marginTop: '0.5rem' }}>
        Zone sizes
      </p>
      <div className="playtest-stats-zones" aria-label="Zone sizes">
        <span className="playtest-stats-zone-pill">
          <span className="playtest-stats-zone-pill__count">{sessionStats.libraryCount}</span>
          <span>Library</span>
        </span>
        <span className="playtest-stats-zone-pill">
          <span className="playtest-stats-zone-pill__count">{sessionStats.graveyardCount}</span>
          <span>Graveyard</span>
        </span>
        <span className="playtest-stats-zone-pill">
          <span className="playtest-stats-zone-pill__count">{sessionStats.exileCount}</span>
          <span>Exile</span>
        </span>
        <span className="playtest-stats-zone-pill">
          <span className="playtest-stats-zone-pill__count">{sessionStats.battlefieldCount}</span>
          <span>Battlefield</span>
        </span>
      </div>

      {/* Simulation context */}
      <div className="playtest-stats-sim">
        <p className="playtest-stats-sim-title">Deck opener profile (500 simulated hands)</p>
        {simResult ? (
          <div className="playtest-stats-rows">
            <div className="playtest-stats-row">
              <span className="playtest-stats-row__label">Keepable</span>
              <span className="playtest-stats-row__value">
                {Math.round(simResult.keepableRate * 100)}%
              </span>
              <MeterBar
                value={simResult.keepableRate * 100}
                max={100}
                color="var(--accent)"
                className="playtest-stats-row__bar"
              />
            </div>
            <div className="playtest-stats-row">
              <span className="playtest-stats-row__label">Avg lands</span>
              <span className="playtest-stats-row__value">{simResult.avgLands.toFixed(1)}</span>
              <MeterBar
                value={simResult.avgLands}
                max={7}
                color="var(--mtg-g)"
                className="playtest-stats-row__bar"
              />
            </div>
            <div className="playtest-stats-row">
              <span className="playtest-stats-row__label">Screw risk</span>
              <span className="playtest-stats-row__value">
                {Math.round(simResult.screwRate * 100)}%
              </span>
              <MeterBar
                value={simResult.screwRate * 100}
                max={100}
                color="var(--warn-text, #f0a000)"
                className="playtest-stats-row__bar"
              />
            </div>
            <div className="playtest-stats-row">
              <span className="playtest-stats-row__label">Flood risk</span>
              <span className="playtest-stats-row__value">
                {Math.round(simResult.floodRate * 100)}%
              </span>
              <MeterBar
                value={simResult.floodRate * 100}
                max={100}
                color="var(--warn-text, #f0a000)"
                className="playtest-stats-row__bar"
              />
            </div>
          </div>
        ) : deck === undefined ? (
          <p className="playtest-stats-sim-note">Deck data unavailable.</p>
        ) : (
          <p className="playtest-stats-sim-note">Deck must have at least 7 cards to simulate.</p>
        )}
      </div>
    </div>
  );
}

interface SimBatch {
  /** Deck identity + shape this batch was computed for — see the invalidation
   *  check below. */
  key: string;
  iterations: number;
  /** Pre-mulligan keepable rate ("Opener"), then cumulative keep rate allowing
   *  1 and 2 mulligans respectively — the "83% keep by mull 1" distribution. */
  keepMull0: number;
  keepMull1: number;
  keepMull2: number;
  avgLands: number;
  screwRate: number;
  floodRate: number;
  landHistogram: number[];
  curve: LandDropCurveResult;
  clock: AssemblyClockResult | null;
}

/** Run the full batch: opener odds (incl. mulligan-to-keep distribution),
 *  land-drop curve, and the assembly clock for the deck's detected win path.
 *  Fixed seed per call → same button press twice gives the same numbers. */
function runSimBatch(deck: Deck, key: string): SimBatch {
  const simCards = deck.cards.map((slot) => toSimCard(slot.card));
  const mull1 = simulateOpeningHands(simCards, { iterations: 1000, seed: 42, mulliganDepth: 1 });
  const mull2 = simulateOpeningHands(simCards, { iterations: 1000, seed: 42, mulliganDepth: 2 });
  const curve = simulateLandDropCurve(simCards, { iterations: 1000, seed: 42 });

  const primary = deck.winConditions?.primary ?? null;
  const libraryNames = deck.cards.map((c) => c.card.name);
  const clock =
    primary?.assembly?.length && libraryNames.length > 0
      ? simulateAssemblyClock(libraryNames, primary.assembly, {
          iterations: 1000,
          seed: 42,
          wildcards: deck.winConditions?.tutors,
        })
      : null;

  return {
    key,
    iterations: mull2.iterations,
    keepMull0: mull2.keepableRate,
    keepMull1: mull1.keepableWithinMulligansRate,
    keepMull2: mull2.keepableWithinMulligansRate,
    avgLands: mull2.avgLands,
    screwRate: mull2.screwRate,
    floodRate: mull2.floodRate,
    landHistogram: mull2.landHistogram,
    curve,
    clock,
  };
}

function SimulateSection({ state, deck }: { state: PlaytestState; deck: Deck | undefined }) {
  const deckKey = deck ? `${deck.id}:${deck.cards.length}` : null;
  const [batch, setBatch] = useState<SimBatch | null>(null);
  const [running, setRunning] = useState(false);

  // Invalidate a stale run the moment the decklist changes (render-phase
  // reset, mirrors DeckTestHandPanel's dealKey pattern) — a cached batch never
  // silently carries over onto a different decklist; the button must be
  // pressed again for the new one.
  if (batch && batch.key !== deckKey) setBatch(null);

  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleSimulate = () => {
    if (!deck || !deckKey) return;
    setRunning(true);
    if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    // Defer one frame so the button's "Simulating…" label paints before the
    // (brief, synchronous) batch occupies the main thread — measured ~50ms for
    // three 1,000-iteration runs against a 99-card deck, well under one frame
    // budget even on phones.
    rafRef.current = window.requestAnimationFrame(() => {
      setBatch(runSimBatch(deck, deckKey));
      setRunning(false);
      rafRef.current = null;
    });
  };

  if (!deck) {
    return <p className="playtest-stats-empty">Deck data unavailable.</p>;
  }
  if (deck.cards.length < 7) {
    return <p className="playtest-stats-empty">Deck must have at least 7 cards to simulate.</p>;
  }

  const actualMedianTurn = medianActualKillTurn(deck.id);
  const maxLandBucket = batch ? Math.max(...batch.landHistogram, 1) : 1;

  return (
    <div className="playtest-stats-rows">
      <p className="playtest-stats-sim-note">
        Runs this deck's opener, land-drop, and assembly-clock models 1,000 times each — the
        goldfishing reps you'd otherwise draw by hand.
      </p>
      <button type="button" className="btn" onClick={handleSimulate} disabled={running}>
        {running && <Loader2 className="playtest-stats-sim-spinner" aria-hidden />}
        {running ? 'Simulating…' : batch ? 'Re-run simulation' : 'Simulate 1,000 games'}
      </button>

      {batch && (
        <>
          <p className="playtest-stats-section-title" style={{ marginTop: 'var(--space-3)' }}>
            Opener odds ({batch.iterations.toLocaleString()} hands)
          </p>
          <div className="playtest-stats-row">
            <span className="playtest-stats-row__label">Keepable</span>
            <span className="playtest-stats-row__value">{Math.round(batch.keepMull0 * 100)}%</span>
            <MeterBar
              value={batch.keepMull0 * 100}
              max={100}
              color="var(--accent)"
              className="playtest-stats-row__bar"
            />
          </div>
          <div className="playtest-stats-row">
            <span className="playtest-stats-row__label">Keep by mull 1</span>
            <span className="playtest-stats-row__value">{Math.round(batch.keepMull1 * 100)}%</span>
            <MeterBar
              value={batch.keepMull1 * 100}
              max={100}
              color="var(--accent)"
              className="playtest-stats-row__bar"
            />
          </div>
          <div className="playtest-stats-row">
            <span className="playtest-stats-row__label">Keep by mull 2</span>
            <span className="playtest-stats-row__value">{Math.round(batch.keepMull2 * 100)}%</span>
            <MeterBar
              value={batch.keepMull2 * 100}
              max={100}
              color="var(--accent)"
              className="playtest-stats-row__bar"
            />
          </div>
          <div className="playtest-stats-row">
            <span className="playtest-stats-row__label">Screw risk</span>
            <span className="playtest-stats-row__value">{Math.round(batch.screwRate * 100)}%</span>
            <MeterBar
              value={batch.screwRate * 100}
              max={100}
              color="var(--warn-text, #f0a000)"
              className="playtest-stats-row__bar"
            />
          </div>
          <div className="playtest-stats-row">
            <span className="playtest-stats-row__label">Flood risk</span>
            <span className="playtest-stats-row__value">{Math.round(batch.floodRate * 100)}%</span>
            <MeterBar
              value={batch.floodRate * 100}
              max={100}
              color="var(--warn-text, #f0a000)"
              className="playtest-stats-row__bar"
            />
          </div>

          <p className="playtest-stats-section-title" style={{ marginTop: 'var(--space-3)' }}>
            Opening-hand land count
          </p>
          <div className="playtest-stats-histogram" aria-label="Land count distribution">
            {batch.landHistogram.map((count, lands) =>
              count > 0 ? (
                <div key={lands} className="playtest-stats-histogram__row">
                  <span className="playtest-stats-histogram__bucket" aria-hidden>
                    {lands}
                  </span>
                  <MeterBar
                    value={count}
                    max={maxLandBucket}
                    color="var(--mtg-g)"
                    className="playtest-stats-histogram__bar"
                  />
                  <span className="playtest-stats-histogram__count">
                    {Math.round((count / batch.iterations) * 100)}%
                  </span>
                </div>
              ) : null
            )}
          </div>
          <p className="playtest-stats-sim-note">
            Avg {batch.avgLands.toFixed(2)} lands in the opener.
          </p>

          <p className="playtest-stats-section-title" style={{ marginTop: 'var(--space-3)' }}>
            On-curve odds, turns 1–5
          </p>
          <div className="playtest-stats-histogram" aria-label="Land-drop curve">
            {batch.curve.onCurveRate.slice(1).map((rate, i) => (
              <div key={i} className="playtest-stats-histogram__row">
                <span className="playtest-stats-histogram__bucket" aria-hidden>
                  T{i + 1}
                </span>
                <MeterBar
                  value={rate * 100}
                  max={100}
                  color="var(--mtg-g)"
                  className="playtest-stats-histogram__bar"
                />
                <span className="playtest-stats-histogram__count">{Math.round(rate * 100)}%</span>
              </div>
            ))}
          </div>
          <p className="playtest-stats-sim-note">
            Draw-per-turn model: no mana curve of the spells themselves, just whether cumulative
            lands drawn kept pace with the turn count.
          </p>

          <div className="playtest-stats-sim">
            <p className="playtest-stats-sim-title">Assembly clock</p>
            {batch.clock ? (
              <>
                <p className="playtest-stats-row" style={{ flexWrap: 'wrap' }}>
                  <Hourglass width={13} height={13} aria-hidden />
                  <span>
                    Predicted: win condition online ~turn <strong>{batch.clock.typicalTurn}</strong>{' '}
                    (median) / <strong>{batch.clock.p90Turn}</strong> (p90)
                  </span>
                  <InfoTip
                    label="the assembly clock"
                    className="playtest-stats-sim-tip"
                    text={assemblyClockTip()}
                  />
                </p>
                {(state.tableDefeatedTurn !== null || actualMedianTurn !== null) && (
                  <div className="playtest-stats-row" style={{ alignItems: 'flex-start' }}>
                    <span className="playtest-stats-row__label">Predicted vs actual</span>
                    <span style={{ flex: 1, textAlign: 'left' }}>
                      Predicted ~T{batch.clock.typicalTurn}
                      {state.tableDefeatedTurn !== null
                        ? ` · this game T${state.tableDefeatedTurn}`
                        : ''}
                      {actualMedianTurn !== null ? ` · median actual T${actualMedianTurn}` : ''}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <p className="playtest-stats-sim-note">
                No win conditions detected — predictions unavailable.
              </p>
            )}
          </div>

          <p className="playtest-stats-sim-note">
            These are draw simulations, not full games — no opponent plays, no interaction, no
            combat. Real games usually move faster than the raw draw math.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Cross-session deck analytics (E141) — aggregates over every recorded
 * `PlaytestSessionRecord` for this deck (device-local history, capped at 50
 * sessions). Sample-size honest: rate/median stats stay hidden below
 * `MIN_SESSIONS_FOR_STATS` sessions rather than implying a trend from 1-2 games.
 */
function HistorySection({ deck }: { deck: Deck | undefined }) {
  // Keyed on deck id only (not the whole deck object) — history only needs to
  // reload when the viewed deck changes, not on every unrelated deck edit.
  const records = useMemo(() => (deck ? loadSessionHistory(deck.id) : []), [deck?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const aggregates = useMemo(() => computeSessionAggregates(records), [records]);

  if (records.length === 0) {
    return <p className="playtest-stats-empty">Finish a game to start your deck's track record.</p>;
  }

  const hasEnoughForRates = aggregates.sessionsPlayed >= MIN_SESSIONS_FOR_STATS;
  const totalKillTurnSamples = aggregates.killTurnHistogram.reduce((sum, b) => sum + b.count, 0);
  const maxHistogramCount = Math.max(1, ...aggregates.killTurnHistogram.map((b) => b.count));
  const sessionsToGo = MIN_SESSIONS_FOR_STATS - aggregates.sessionsPlayed;

  return (
    <div className="playtest-stats-rows">
      <div className="playtest-stats-row">
        <span className="playtest-stats-row__label">Sessions played</span>
        <span className="playtest-stats-row__value">{aggregates.sessionsPlayed}</span>
      </div>

      {aggregates.bestKillTurn !== null && (
        <div className="playtest-stats-row">
          <span className="playtest-stats-row__label">Best kill</span>
          <span className="playtest-stats-verdict playtest-stats-verdict--keep">
            Turn {aggregates.bestKillTurn}
          </span>
        </div>
      )}

      {!hasEnoughForRates ? (
        <p className="playtest-stats-sim-note">
          Play {sessionsToGo} more game{sessionsToGo === 1 ? '' : 's'} to unlock rate stats.
        </p>
      ) : (
        <>
          {aggregates.medianKillTurn !== null && (
            <div className="playtest-stats-row">
              <span className="playtest-stats-row__label">Median kill</span>
              <span className="playtest-stats-row__value">Turn {aggregates.medianKillTurn}</span>
            </div>
          )}

          <div className="playtest-stats-row">
            <span className="playtest-stats-row__label">Kill rate</span>
            <span className="playtest-stats-row__value">
              {Math.round(aggregates.killRate * 100)}%
            </span>
            <MeterBar
              value={aggregates.killRate * 100}
              max={100}
              color="var(--mtg-g)"
              className="playtest-stats-row__bar"
            />
          </div>

          <div className="playtest-stats-row">
            <span className="playtest-stats-row__label">Avg mulligans</span>
            <span className="playtest-stats-row__value">{aggregates.avgMulligans.toFixed(1)}</span>
          </div>

          {aggregates.landDropMissRate !== null && (
            <div className="playtest-stats-row">
              <span className="playtest-stats-row__label">Land-drop miss rate</span>
              <span className="playtest-stats-row__value">
                {Math.round(aggregates.landDropMissRate * 100)}%
              </span>
              <MeterBar
                value={aggregates.landDropMissRate * 100}
                max={100}
                color="var(--warn-text, #f0a000)"
                className="playtest-stats-row__bar"
              />
            </div>
          )}

          {aggregates.wipeSurvivalRate !== null && (
            <div className="playtest-stats-row">
              <span className="playtest-stats-row__label">Wipes survived</span>
              <span className="playtest-stats-row__value">
                {Math.round(aggregates.wipeSurvivalRate * 100)}%
              </span>
              <MeterBar
                value={aggregates.wipeSurvivalRate * 100}
                max={100}
                color="var(--accent)"
                className="playtest-stats-row__bar"
              />
            </div>
          )}

          {totalKillTurnSamples >= 5 && (
            <>
              <p className="playtest-stats-section-title" style={{ marginTop: '0.5rem' }}>
                Kill-turn distribution
              </p>
              <div className="playtest-stats-histogram" aria-label="Kill turn distribution">
                {aggregates.killTurnHistogram.map((bucket) => (
                  <div key={bucket.turn} className="playtest-stats-histogram__row">
                    <span className="playtest-stats-histogram__bucket" aria-hidden>
                      T{bucket.turn}
                    </span>
                    <MeterBar
                      value={bucket.count}
                      max={maxHistogramCount}
                      color="var(--accent)"
                      className="playtest-stats-histogram__bar"
                    />
                    <span className="playtest-stats-histogram__count">{bucket.count}</span>
                  </div>
                ))}
              </div>
              <p className="playtest-stats-sim-note">
                Based on {totalKillTurnSamples} recorded kill{totalKillTurnSamples === 1 ? '' : 's'}
                .
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PlaytestStatsSheet({ state, deck, cardLookup, mulliganCount, onClose }: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  useLockBodyScroll();
  useEscapeKey(beginClose);
  const [activeTab, setActiveTab] = useState<StatsTab>('hand');

  return (
    <div className="card-picker-root" role="presentation">
      <div className="card-picker-backdrop" role="presentation" onClick={() => beginClose()} />
      <div
        className={`card-picker-sheet playtest-stats-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="playtest-stats-title"
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-header">
          <h2 id="playtest-stats-title" className="card-picker-title">
            Stats
          </h2>
        </div>

        <Tabs
          tabs={TABS}
          value={activeTab}
          onChange={setActiveTab}
          ariaLabel="Stats view"
          variant="underline"
        />

        <div className="playtest-stats-body">
          {activeTab === 'hand' && (
            <div role="tabpanel" id="playtest-stats-panel-hand" aria-labelledby="sc-tab-hand">
              <HandStatsSection state={state} cardLookup={cardLookup} />
            </div>
          )}
          {activeTab === 'battlefield' && (
            <div
              role="tabpanel"
              id="playtest-stats-panel-battlefield"
              aria-labelledby="sc-tab-battlefield"
            >
              <BattlefieldStatsSection state={state} />
            </div>
          )}
          {activeTab === 'deck' && (
            <div role="tabpanel" id="playtest-stats-panel-deck" aria-labelledby="sc-tab-deck">
              <DeckStatsSection state={state} deck={deck} mulliganCount={mulliganCount} />
            </div>
          )}
          {activeTab === 'simulate' && (
            <div
              role="tabpanel"
              id="playtest-stats-panel-simulate"
              aria-labelledby="sc-tab-simulate"
            >
              <SimulateSection state={state} deck={deck} />
            </div>
          )}
          {activeTab === 'history' && (
            <div role="tabpanel" id="playtest-stats-panel-history" aria-labelledby="sc-tab-history">
              <HistorySection deck={deck} />
            </div>
          )}
        </div>

        <div className="card-picker-footer" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => beginClose()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
