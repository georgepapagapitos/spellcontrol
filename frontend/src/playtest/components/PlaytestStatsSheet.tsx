import { useMemo, useState } from 'react';
import './PlaytestStatsSheet.css';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import type { PlaytestState } from '@/lib/playtest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '@/store/decks';
import {
  computeHandStats,
  computeBattlefieldStats,
  computeDeckStats,
  toHandSimCards,
} from '@/lib/playtest-stats';
import { isKeepableHand, simulateOpeningHands } from '@/lib/opening-hand-sim';
import { toSimCard } from '@/lib/hand-classify';
import { MeterBar, StackedBar } from '@/components/shared/MeterBar';
import { ColorPip, TypeIcon } from '@/components/shared/ManaSymbol';
import { Tabs, type TabItem } from '@/components/Tabs';

// ── Types ─────────────────────────────────────────────────────────────────────

type StatsTab = 'hand' | 'battlefield' | 'deck';

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
              color: 'var(--color-green, #3a7d44)',
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

  return (
    <div className="playtest-stats-rows">
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
                color="var(--color-green, #3a7d44)"
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

// ── Main component ────────────────────────────────────────────────────────────

export function PlaytestStatsSheet({ state, deck, cardLookup, mulliganCount, onClose }: Props) {
  useLockBodyScroll();
  const [activeTab, setActiveTab] = useState<StatsTab>('hand');

  return (
    <div className="card-picker-root" role="presentation">
      <div className="card-picker-backdrop" role="presentation" onClick={onClose} />
      <div
        className="card-picker-sheet playtest-stats-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playtest-stats-title"
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
          variant="fitted"
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
        </div>

        <div className="card-picker-footer" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
