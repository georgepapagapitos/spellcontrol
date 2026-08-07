import { Check, ChevronDown, Dices, RotateCcw } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  BudgetOption,
  CollectionStrategy,
  Customization,
  GameChangerLimit,
  ManaPhilosophy,
  MaxRarity,
  Pacing,
} from '@/deck-builder/types';
import { autocompleteCardName, getBanList } from '@/deck-builder/services/scryfall/client';
import { constrainsToCollection } from '@/deck-builder/services/deckBuilder/deckFilters';
import { normalizeManaPhilosophy } from '@/deck-builder/services/deckBuilder/manaPhilosophy';
import { currencySymbol } from '@/lib/currency';
import { isNativePlatform, openExternal } from '@/lib/platform';
import { buildAvailableCollection } from '../../lib/collection-availability';
import { SearchPill } from '../SearchPill';
import { InfoTip } from '../InfoTip';
import { StackedBar } from '../shared/MeterBar';
import { useSearchCards } from '../../lib/use-search-cards';
import { useDeckBuilderStore } from '@/deck-builder/store';
import { useCollectionStore } from '../../store/collection';
import { useCubeStore } from '../../store/cube';
import { useDecksStore } from '../../store/decks';

type Update = (patch: Partial<Customization>) => void;

interface DeckCustomizerProps {
  customization: Customization;
  update: Update;
}

export function DeckCustomizer({ customization, update }: DeckCustomizerProps) {
  const suggestion = useDeckBuilderStore((s) => s.edhrecLandSuggestion);
  const setUserEditedLands = useDeckBuilderStore((s) => s.setUserEditedLands);

  // When collection mode constrains the build to owned cards, the must-include
  // picker searches that same pool instead of all of Scryfall — a pick outside
  // the pool would only be skipped at generation time anyway.
  const poolConstrained =
    customization.collectionMode && constrainsToCollection(customization.collectionStrategy);
  const collectionCardsForPool = useCollectionStore((s) => s.cards);
  const decksForPool = useDecksStore((s) => s.decks);
  const savedCubesForPool = useCubeStore((s) => s.saved);
  const poolFetcher = useMemo(() => {
    if (!poolConstrained) return undefined;
    const names =
      customization.collectionStrategy === 'available'
        ? [
            ...buildAvailableCollection(collectionCardsForPool, decksForPool, savedCubesForPool)
              .names,
          ]
        : [...new Set(collectionCardsForPool.map((c) => c.name))];
    return (q: string) => {
      const needle = q.toLowerCase();
      const hits = names.filter((n) => n.toLowerCase().includes(needle));
      hits.sort((a, b) => {
        const ap = a.toLowerCase().startsWith(needle) ? 0 : 1;
        const bp = b.toLowerCase().startsWith(needle) ? 0 : 1;
        return ap - bp || a.localeCompare(b);
      });
      return Promise.resolve(hits);
    };
  }, [
    poolConstrained,
    customization.collectionStrategy,
    collectionCardsForPool,
    decksForPool,
    savedCubesForPool,
  ]);

  const handleResetLands = () => {
    if (!suggestion) return;
    update({
      landCount: suggestion.landCount,
      nonBasicLandCount: suggestion.nonBasicLandCount,
    });
    setUserEditedLands(false);
  };

  const handleResetAll = () => {
    update({
      targetBracket: 'all',
      collectionMode: false,
      deckBudget: null,
      maxCardPrice: null,
      ignoreOwnedBudget: false,
      budgetOption: 'any',
      maxRarity: null,
      ignoreOwnedRarity: false,
      gameChangerLimit: 'unlimited',
      comboCount: 1,
      arenaOnly: false,
      tinyLeaders: false,
      banLists: [],
      tempoAutoDetect: true,
      saltTolerance: 2,
      brewLevel: 0.5,
      varietySeed: undefined,
      scryfallQuery: '',
      mustIncludeCards: [],
      bannedCards: [],
      manaPhilosophy: undefined,
      ...(suggestion
        ? { landCount: suggestion.landCount, nonBasicLandCount: suggestion.nonBasicLandCount }
        : {}),
    });
    setUserEditedLands(false);
  };

  return (
    <section className="deck-builder-section deck-customizer">
      <header className="deck-customizer-title-row">
        <h2 className="deck-builder-section-title">Customize</h2>
        <button
          type="button"
          className="deck-customizer-group-reset"
          onClick={handleResetAll}
          title="Reset all customization to defaults"
        >
          <RotateCcw width={12} height={12} strokeWidth={2} aria-hidden />
          Reset
        </button>
      </header>

      <div className="deck-customizer-body">
        <BracketGroup customization={customization} update={update} />
        <BrewGroup customization={customization} update={update} />
        <CollectionGroup customization={customization} update={update} />

        <div className="deck-customizer-group">
          <div className="deck-customizer-group-header">
            <h3 className="deck-customizer-group-title">Lands</h3>
            {suggestion && (
              <button
                type="button"
                className="deck-customizer-group-reset"
                onClick={handleResetLands}
                title={`Reset to EDHREC suggestion (${suggestion.landCount} / ${suggestion.nonBasicLandCount})`}
              >
                <RotateCcw width={12} height={12} strokeWidth={2} aria-hidden />
                Reset
              </button>
            )}
          </div>
          <div className="deck-customizer-group-body">
            <SizeAndLandsGroup customization={customization} update={update} />
          </div>
        </div>

        <CollapsibleGroup
          title="Mana philosophy"
          defaultOpen={false}
          summary={manaPhilosophySummary(customization)}
        >
          <ManaPhilosophyGroup customization={customization} update={update} />
        </CollapsibleGroup>

        <CollapsibleGroup title="Budget" defaultOpen={false} summary={budgetSummary(customization)}>
          <BudgetGroup customization={customization} update={update} />
        </CollapsibleGroup>
        <CollapsibleGroup
          title="Card pool"
          defaultOpen={false}
          summary={poolSummary(customization)}
        >
          <PoolGroup customization={customization} update={update} />
        </CollapsibleGroup>
        <CollapsibleGroup
          title="Variety"
          defaultOpen={false}
          summary={varietySummary(customization)}
        >
          <VarietyGroup customization={customization} update={update} />
        </CollapsibleGroup>
        <CollapsibleGroup title="Tempo" defaultOpen={false} summary={tempoSummary(customization)}>
          <TempoGroup customization={customization} update={update} />
        </CollapsibleGroup>
        <CollapsibleGroup
          title="Salt"
          defaultOpen={false}
          summary={SALT_LABELS[customization.saltTolerance ?? 2]}
        >
          <SaltGroup customization={customization} update={update} />
        </CollapsibleGroup>
        <CollapsibleGroup
          title="Scryfall filter"
          defaultOpen={false}
          summary={customization.scryfallQuery.trim() || 'None'}
        >
          <ScryfallGroup customization={customization} update={update} />
        </CollapsibleGroup>
        <CollapsibleGroup
          title="Must-include cards"
          defaultOpen={false}
          count={customization.mustIncludeCards.length}
        >
          <CardListGroup
            hint={
              poolFetcher
                ? `These cards are forced into the deck before EDHREC suggestions are considered. While "Build from my collection" is on, search is limited to ${
                    customization.collectionStrategy === 'available'
                      ? 'free copies in your collection'
                      : 'cards you own'
                  }.`
                : 'These cards are forced into the deck before EDHREC suggestions are considered.'
            }
            values={customization.mustIncludeCards}
            onChange={(next) => update({ mustIncludeCards: next })}
            fetcher={poolFetcher}
          />
        </CollapsibleGroup>
        <CollapsibleGroup
          title="Excluded cards"
          defaultOpen={false}
          count={customization.bannedCards.length}
        >
          <CardListGroup
            hint="These cards will never be suggested by the generator."
            values={customization.bannedCards}
            onChange={(next) => update({ bannedCards: next })}
          />
        </CollapsibleGroup>
        <CollapsibleGroup
          title="Ban lists"
          defaultOpen={false}
          count={(customization.banLists ?? []).length}
        >
          <BanListsGroup customization={customization} update={update} />
        </CollapsibleGroup>
      </div>
    </section>
  );
}

function BracketGroup({ customization, update }: DeckCustomizerProps) {
  // Radios group by shared `name` — scope it per mounted group.
  const bracketGroup = useId();
  const options = [
    { v: 'all' as const, label: 'Any', sub: 'No filter' },
    { v: 1 as const, label: '1', sub: 'Exhibition' },
    { v: 2 as const, label: '2', sub: 'Core' },
    { v: 3 as const, label: '3', sub: 'Upgraded' },
    { v: 4 as const, label: '4', sub: 'Optimized' },
    { v: 5 as const, label: '5', sub: 'cEDH' },
  ];
  return (
    <div className="deck-customizer-group">
      <div className="deck-customizer-group-header">
        <h3 className="deck-customizer-group-title">Target Bracket</h3>
      </div>
      <div className="deck-customizer-group-body">
        {/* Native radios: exclusivity + arrow-key nav + one group tab stop. */}
        <fieldset className="bracket-pill-row" aria-label="Target bracket">
          {options.map((b) => {
            const active = String(customization.targetBracket) === String(b.v);
            return (
              <label key={String(b.v)} className={`bracket-pill${active ? ' active' : ''}`}>
                <input
                  type="radio"
                  name={bracketGroup}
                  value={String(b.v)}
                  checked={active}
                  onChange={() => update({ targetBracket: b.v })}
                />
                <span className="bracket-pill-label">{b.label}</span>
                <span className="bracket-pill-sub">{b.sub}</span>
              </label>
            );
          })}
        </fieldset>
        {customization.targetBracket === 1 && (
          <p className="deck-customizer-hint">
            Exhibition is a themed-build intent, not a power level — expect the build report to
            estimate it at Core (2) or higher.
          </p>
        )}
      </div>
    </div>
  );
}

const SALT_LABELS = ['Unsalted', 'Low', 'Any', 'Extra'];

const PACING_LABELS: Record<Pacing, string> = {
  'aggressive-early': 'Aggressive',
  'fast-tempo': 'Fast',
  balanced: 'Balanced',
  midrange: 'Midrange',
  'late-game': 'Late game',
};

// ── Collapsed-header summaries — the group's current setting at a glance ──
function budgetSummary(c: Customization): string {
  const sym = currencySymbol(c.currency);
  const parts = [
    c.deckBudget != null ? `${sym}${c.deckBudget} deck` : null,
    c.maxCardPrice != null ? `${sym}${c.maxCardPrice} card` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No limits';
}

function poolSummary(c: Customization): string {
  const gc = c.gameChangerLimit;
  const parts = [
    c.budgetOption === 'budget'
      ? 'Budget picks'
      : c.budgetOption === 'expensive'
        ? 'Premium picks'
        : null,
    c.maxRarity ? `${c.maxRarity[0].toUpperCase()}${c.maxRarity.slice(1)} max` : null,
    gc === 'none'
      ? 'No game changers'
      : typeof gc === 'number'
        ? `Up to ${gc} game changers`
        : null,
    c.comboCount === 0
      ? 'No combos'
      : c.comboCount === 2
        ? 'Extra combos'
        : c.comboCount === 3
          ? 'Many combos'
          : null,
    c.arenaOnly ? 'Arena only' : null,
    c.tinyLeaders ? 'Tiny Leaders' : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Any card';
}

function varietySummary(c: Customization): string {
  return c.varietySeed === undefined ? 'Signature build' : `Roll #${c.varietySeed}`;
}

function tempoSummary(c: Customization): string {
  return c.tempoAutoDetect ? 'Auto-detect' : PACING_LABELS[c.tempoPacing];
}

function manaPhilosophySummary(c: Customization): string {
  if (!c.manaPhilosophy) return 'Off';
  const shares = normalizeManaPhilosophy(c.manaPhilosophy);
  const ranked = MP_AXES.map((a) => [a.label, shares[a.key]] as const).sort((a, b) => b[1] - a[1]);
  const spread = ranked[0][1] - ranked[3][1];
  // A near-flat blend (every axis within a few points of the floor-driven
  // 25% center) reads as "Equal blend" rather than naming whichever axis
  // happens to round up first — the two are genuinely different settings
  // (see ManaPhilosophyGroup) and the summary shouldn't blur them.
  if (spread < 0.03) return 'Equal blend';
  return `${ranked[0][0]}-leaning`;
}

function SaltGroup({ customization, update }: DeckCustomizerProps) {
  const value = (customization.saltTolerance ?? 2) as number;
  const SALT_DESCRIPTIONS: Record<number, string> = {
    0: 'Strict filter — exclude EDHREC salt > 0.75 (pillow-fort friendly)',
    1: 'Moderate filter — exclude EDHREC salt > 2.0 (no Armageddon, no Cyclonic Rift)',
    2: 'No salt filtering (default)',
    3: 'No filter — boost high-salt staples in the priority order',
  };
  return (
    <div className="deck-customizer-slider">
      <p
        className="deck-customizer-slider-hint"
        style={{
          margin: '0 0 0.75rem',
          fontSize: '0.85em',
          lineHeight: 1.4,
          opacity: 0.75,
        }}
      >
        <a
          href="https://edhrec.com/top/salt"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit', textDecoration: 'underline' }}
          onClick={(e) => {
            if (!isNativePlatform()) return;
            e.preventDefault();
            openExternal('https://edhrec.com/top/salt');
          }}
        >
          EDHREC&apos;s salt scores
        </a>{' '}
        tally votes for the most-hated cards in the format — think Stax, Armageddon, Cyclonic Rift.
        Slide left to leave them out, right to lean into them.
      </p>
      <input
        type="range"
        className="deck-customizer-range"
        min={0}
        max={3}
        step={1}
        value={value}
        aria-label="Salt level"
        title={SALT_DESCRIPTIONS[value]}
        onChange={(e) => update({ saltTolerance: Number(e.target.value) as 0 | 1 | 2 | 3 })}
        style={{
          ['--range-progress' as string]: `${(value / 3) * 100}%`,
        }}
      />
      <div className="deck-customizer-slider-anchors">
        {SALT_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            className="deck-customizer-slider-anchor"
            data-align={i === 0 ? 'start' : i === SALT_LABELS.length - 1 ? 'end' : 'center'}
            aria-label={`Set salt level to ${label}`}
            aria-pressed={value === i}
            title={SALT_DESCRIPTIONS[i]}
            onClick={() => update({ saltTolerance: i as 0 | 1 | 2 | 3 })}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <span className="deck-customizer-slider-anchor-label">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// 5 stops: 0 / 0.25 / 0.5 / 0.75 / 1 — endpoints "Staples" / "Brew", center
// "Balanced" (the default, a no-op — see cardPicking.ts's calculateCardPriority).
type BrewStop = 0 | 0.25 | 0.5 | 0.75 | 1;
const BREW_LABELS: Record<BrewStop, string> = {
  0: 'Staples',
  0.25: 'Leaning staples',
  0.5: 'Balanced',
  0.75: 'Leaning brew',
  1: 'Brew',
};
const BREW_DESCRIPTIONS: Record<BrewStop, string> = {
  0: "The proven 99 — EDHREC's most-played picks.",
  0.25: 'Mostly staples, with some room for cards that fit your theme.',
  0.5: 'An even mix of proven staples and theme-driven picks.',
  1: "Deep cuts — cards that fit your theme's mechanics over the popular picks.",
  0.75: 'Mostly deep cuts, keeping the strongest staples.',
};

function BrewGroup({ customization, update }: DeckCustomizerProps) {
  const value = (customization.brewLevel ?? 0.5) as BrewStop;
  const label = BREW_LABELS[value] ?? BREW_LABELS[0.5];
  const description = BREW_DESCRIPTIONS[value] ?? BREW_DESCRIPTIONS[0.5];
  return (
    <div className="deck-customizer-group">
      <div className="deck-customizer-group-header">
        <h3 className="deck-customizer-group-title">Staples ↔ Brew</h3>
        <span className="deck-customizer-slider-value">{label}</span>
      </div>
      <div className="deck-customizer-group-body">
        <div className="deck-customizer-slider">
          <input
            type="range"
            className="deck-customizer-range"
            min={0}
            max={1}
            step={0.25}
            value={value}
            aria-label="Staples to Brew dial — how much to favor EDHREC's most-played cards over off-meta theme fits"
            aria-valuetext={label}
            onChange={(e) => update({ brewLevel: Number(e.target.value) })}
            style={{
              ['--range-progress' as string]: `${value * 100}%`,
            }}
          />
          <div className="deck-customizer-slider-anchors">
            <span className="deck-customizer-slider-anchor" data-align="start">
              <span className="deck-customizer-slider-anchor-label">Staples</span>
            </span>
            <span className="deck-customizer-slider-anchor" data-align="center">
              <span className="deck-customizer-slider-anchor-label">Balanced</span>
            </span>
            <span className="deck-customizer-slider-anchor" data-align="end">
              <span className="deck-customizer-slider-anchor-label">Brew</span>
            </span>
          </div>
          <p className="deck-customizer-slider-desc">{description}</p>
        </div>
      </div>
    </div>
  );
}

// Variety reroll — a reproducible "shake up close calls" lever. Each roll is
// a seed: the same roll + settings rebuilds the same deck (see cardPicking.ts's
// computeVarietyJitterBoosts), so variety never costs determinism.
function VarietyGroup({ customization, update }: DeckCustomizerProps) {
  const roll = customization.varietySeed;
  return (
    <div className="deck-customizer-variety">
      <div className="deck-customizer-slider-header">
        <span
          className="deck-customizer-slider-value"
          style={{ marginLeft: 'auto' }}
          aria-live="polite"
        >
          {roll === undefined ? 'Signature build' : `Roll #${roll}`}
        </span>
      </div>
      <div className="deck-customizer-variety-actions">
        <button
          type="button"
          className="deck-customizer-reroll-btn"
          onClick={() => update({ varietySeed: (roll ?? 0) + 1 })}
        >
          <Dices width={16} height={16} strokeWidth={2} aria-hidden />
          Reroll
        </button>
        {roll !== undefined && (
          <button
            type="button"
            className="deck-customizer-group-reset"
            onClick={() => update({ varietySeed: undefined })}
            title="Back to the signature build — the same best deck every time"
          >
            <RotateCcw width={12} height={12} strokeWidth={2} aria-hidden />
            Reset
          </button>
        )}
      </div>
      <p className="deck-customizer-slider-desc">
        {roll === undefined
          ? 'The signature build: these settings pick the same best deck every time. Reroll to shake up close calls between similar cards.'
          : 'Close calls between similar cards follow this roll. The same roll rebuilds the same deck — reroll again for a fresh take.'}
      </p>
    </div>
  );
}

function CollectionGroup({ customization, update }: DeckCustomizerProps) {
  const collectionCards = useCollectionStore((s) => s.cards);
  const uniqueCount = new Set(collectionCards.map((c) => c.name)).size;
  const active = customization.collectionMode;
  const empty = uniqueCount === 0;
  const strategy = customization.collectionStrategy;
  const pct = customization.collectionOwnedPercent;
  const sub = empty
    ? 'Import cards on the Collection page to enable this.'
    : active
      ? strategy === 'partial'
        ? `Prioritizing your cards (~${pct}% owned); the rest come from outside your collection.`
        : strategy === 'available'
          ? 'Generator will only use copies not committed to other decks.'
          : strategy === 'prefer'
            ? 'Builds the best deck it can while favoring cards you already own — no card is excluded.'
            : 'Generator will only suggest cards you own.'
      : 'Constrain the build to your owned cards.';
  return (
    <div className={`deck-customizer-group collection-group${active ? ' active' : ''}`}>
      <label className="collection-group-row">
        <input
          type="checkbox"
          className="collection-group-checkbox"
          checked={active}
          disabled={empty}
          onChange={(e) => update({ collectionMode: e.target.checked })}
        />
        <span className="collection-group-text">
          <span className="collection-group-title-row">
            <span className="collection-group-title">Build from my collection</span>
            <span className="collection-group-badge" aria-hidden>
              {uniqueCount.toLocaleString()} unique
            </span>
          </span>
          <span className="collection-group-sub">{sub}</span>
        </span>
      </label>

      {active && (
        <div className="collection-group-controls">
          <Field label="Collection strategy">
            <OptionGrid<CollectionStrategy>
              value={strategy}
              options={[
                { value: 'prefer', label: 'Favor mine', sublabel: 'Owned-first' },
                { value: 'full', label: 'Only my cards', sublabel: 'Owned only' },
                { value: 'partial', label: 'Prioritize mine', sublabel: 'Target %' },
                { value: 'available', label: 'Available only', sublabel: 'Free copies' },
              ]}
              onChange={(v) => update({ collectionStrategy: v })}
            />
          </Field>

          {strategy === 'partial' && (
            <div className="deck-customizer-slider">
              <div className="deck-customizer-slider-header">
                <span className="deck-customizer-slider-label">Target owned</span>
                <span className="deck-customizer-slider-value">{pct}%</span>
              </div>
              <input
                type="range"
                className="deck-customizer-range"
                min={25}
                max={100}
                step={5}
                value={pct}
                aria-label="Target owned percent"
                onChange={(e) => update({ collectionOwnedPercent: Number(e.target.value) })}
                style={{
                  ['--range-progress' as string]: `${((pct - 25) / 75) * 100}%`,
                }}
              />
              <div className="deck-customizer-slider-anchors">
                <span className="deck-customizer-slider-anchor" data-align="start">
                  <span className="deck-customizer-slider-anchor-label">25%</span>
                </span>
                <span className="deck-customizer-slider-anchor" data-align="end">
                  <span className="deck-customizer-slider-anchor-label">100%</span>
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CollapsibleGroup({
  title,
  defaultOpen,
  count,
  summary,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  count?: number;
  /** Current setting, shown muted in the header while the group is closed. */
  summary?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div
      className={`deck-customizer-group deck-customizer-group-collapsible${open ? ' open' : ''}`}
    >
      <button
        type="button"
        className="deck-customizer-group-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="deck-customizer-group-toggle-title">
          <span className="deck-customizer-group-title">{title}</span>
          {typeof count === 'number' && count > 0 && (
            <span className="deck-customizer-group-count" aria-label={`${count} selected`}>
              {count}
            </span>
          )}
        </span>
        {!open && summary && <span className="deck-customizer-group-summary">{summary}</span>}
        <ChevronDown width={14} height={14} strokeWidth={2} aria-hidden />
      </button>
      {open && <div className="deck-customizer-group-body">{children}</div>}
    </div>
  );
}

// ── Size + lands ──────────────────────────────────────────────────────────
function SizeAndLandsGroup({ customization, update }: DeckCustomizerProps) {
  const total = customization.landCount;
  const nonBasic = Math.min(customization.nonBasicLandCount, total);
  const basics = total - nonBasic;
  const balancedNonBasic = Math.round(total / 2);
  const suggestion = useDeckBuilderStore((s) => s.edhrecLandSuggestion);
  const setUserEditedLands = useDeckBuilderStore((s) => s.setUserEditedLands);

  const handleTotal = (n: number) => {
    update({ landCount: n });
    setUserEditedLands(true);
  };
  const handleNonBasic = (n: number) => {
    update({ nonBasicLandCount: n });
    setUserEditedLands(true);
  };

  return (
    <>
      <RangeSlider
        label="Total lands"
        ariaLabel="Total lands"
        value={total}
        min={32}
        max={42}
        onChange={handleTotal}
        anchors={[
          { value: 32, label: 'Aggro' },
          { value: 37, label: 'Standard' },
          { value: 42, label: 'Control' },
        ]}
        suggested={suggestion ? total === suggestion.landCount : false}
      />
      <RangeSlider
        label="Non-basic lands"
        ariaLabel="Non-basic lands"
        value={nonBasic}
        min={0}
        max={total}
        valueSuffix={`(${basics} basic${basics === 1 ? '' : 's'})`}
        onChange={handleNonBasic}
        anchors={[
          { value: 0, label: 'Basic' },
          { value: balancedNonBasic, label: 'Balanced' },
          { value: total, label: 'Varied' },
        ]}
        suggested={suggestion ? nonBasic === suggestion.nonBasicLandCount : false}
      />
    </>
  );
}

// ── Mana philosophy (E234) ───────────────────────────────────────────────
//
// Four blendable land-priority weights (manaPhilosophy.ts) that the generator
// folds into its nonbasic-land ranking. `customization.manaPhilosophy` is
// `undefined` until the user deliberately turns this on — that's the OFF
// state generation stays byte-identical for (E231). Turning it on seeds every
// axis at its floor-driven equal share (a real, distinct setting — "every
// priority weighted the same" is not the same fact as "no preference set").
//
// Presets-vs-blend: tested by simulating computeManaPhilosophyBoosts at the
// four single-axis corners and at two-axis blends (see PR description). A
// 50/50 greedy+budget blend re-ranks candidate lands in an order neither the
// pure-greedy nor pure-budget preset produces (it keeps the utility lean but
// drops the expensive utility lands a pure-greedy preset would still put
// first) — a real, reachable-only-by-blending intent ("useful, but not
// pricey"). Presets alone would lose that combination, so this ships as four
// sliders, not four preset buttons.
//
// Each slider stores its own 0-MP_SLIDER_MAX raw weight directly — no
// bespoke sum-preserving redistribution math. The max is deliberately small
// (not 100): at WEIGHT_FLOOR=0.05, a raw max of 100 floors an idle axis down
// to a 0.05/100.2 ≈ 0.05% share, which rounds to a misleading "0.0%" at one
// decimal — reading as zero even though the engine never treats it as zero.
// 20 keeps every floored share's rounded display safely above 0.0% (≈0.2% at
// the extreme) while still reaching a ~99% single-axis lean.
// `normalizeManaPhilosophy` (imported, never re-implemented) is called on
// every render to compute the live share shown next to each slider and in
// the stacked bar, so what's on screen is always exactly what generation
// will use: moving one slider visibly raises its own share and lowers the
// other three's, live, because they're all deriving from the same
// normalize() call over the four raw numbers.
const MP_SLIDER_MAX = 20;

const MP_AXES: {
  key: keyof ManaPhilosophy;
  label: string;
  hint: string;
  color: string;
}[] = [
  {
    key: 'reliable',
    label: 'Color fixing',
    hint: 'Favors lands that tap more of your deck’s colors over off-color picks.',
    color: 'var(--accent)',
  },
  {
    key: 'greedy',
    label: 'Utility',
    hint: 'Favors lands with a real ability — draw, scry, damage — over plain fixing.',
    color: 'var(--info)',
  },
  {
    key: 'spelllands',
    label: 'Spell-lands',
    hint: 'Favors modal double-faced cards you can cast as a spell instead of playing as a land.',
    color: 'var(--success)',
  },
  {
    key: 'budget',
    label: 'Budget',
    hint: 'Favors cheaper lands. Capped, so it never fully overrules the other priorities.',
    color: 'var(--warn-text)',
  },
];

const MP_OFF: ManaPhilosophy = { reliable: 0, greedy: 0, spelllands: 0, budget: 0 };

function ManaPhilosophyGroup({ customization, update }: DeckCustomizerProps) {
  const active = !!customization.manaPhilosophy;
  const weights = customization.manaPhilosophy ?? MP_OFF;
  const shares = normalizeManaPhilosophy(weights);

  return (
    <div className="mana-philosophy-group">
      <p className="deck-customizer-hint">
        Blend four priorities for the nonbasic lands the generator picks: reliable color fixing,
        useful abilities, modal spell-lands, and price. Off by default — every deck keeps today’s
        land priority until you turn this on.
      </p>
      <label className="collection-group-row">
        <input
          type="checkbox"
          className="collection-group-checkbox"
          checked={active}
          // Explicit aria-label: the implicit <label> wrapping would otherwise
          // concatenate the sub-description text below into the accessible
          // name too, which reads as a run-on to a screen reader.
          aria-label="Blend land priorities"
          onChange={(e) => update({ manaPhilosophy: e.target.checked ? MP_OFF : undefined })}
        />
        <span className="collection-group-text">
          <span className="collection-group-title">Blend land priorities</span>
          <span className="collection-group-sub">
            {active
              ? 'Blending the four priorities below into the nonbasic land picks.'
              : 'Off — lands use the default priority order.'}
          </span>
        </span>
      </label>

      {active && (
        <div className="mana-philosophy-controls">
          <StackedBar
            className="mana-philosophy-bar"
            size="md"
            title={MP_AXES.map((a) => `${a.label} ${(shares[a.key] * 100).toFixed(1)}%`).join(
              ' · '
            )}
            segments={MP_AXES.map((a) => ({
              key: a.key,
              value: shares[a.key],
              color: a.color,
              title: `${a.label} ${(shares[a.key] * 100).toFixed(1)}%`,
            }))}
          />
          <ul className="mana-philosophy-legend">
            {MP_AXES.map((a) => (
              <li key={a.key} className="mana-philosophy-legend-item">
                <span
                  className="mana-philosophy-swatch"
                  style={{ background: a.color }}
                  aria-hidden
                />
                {a.label}
              </li>
            ))}
          </ul>

          {MP_AXES.map((a) => {
            const pct = shares[a.key] * 100;
            const pctLabel = `${pct.toFixed(1)}%`;
            return (
              <div className="deck-customizer-slider" key={a.key}>
                <div className="deck-customizer-slider-header">
                  <span className="deck-customizer-slider-label">
                    {a.label}
                    <InfoTip label={a.label} text={a.hint} />
                  </span>
                  <span className="deck-customizer-slider-value">{pctLabel}</span>
                </div>
                <input
                  type="range"
                  className="deck-customizer-range"
                  min={0}
                  max={MP_SLIDER_MAX}
                  step={2}
                  value={weights[a.key]}
                  aria-label={`${a.label} priority`}
                  aria-valuetext={pctLabel}
                  title={a.hint}
                  onChange={(e) =>
                    update({ manaPhilosophy: { ...weights, [a.key]: Number(e.target.value) } })
                  }
                  style={{
                    ['--range-progress' as string]: `${(weights[a.key] / MP_SLIDER_MAX) * 100}%`,
                  }}
                />
              </div>
            );
          })}

          <p className="deck-customizer-slider-desc">
            Every priority keeps a small floor — none ever drops to zero, so even a maxed-out slider
            still leaves the others a little room.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Budget ────────────────────────────────────────────────────────────────
//
// Reference-repo pattern: a row of preset buttons (None / $25 / $50 / $100 /
// $200 / Custom) where Custom swaps to an inline numeric input. Beats a
// stand-alone number field for both speed (one click for common values) and
// affordance (presets advertise the format and approximate scale).
function BudgetGroup({ customization, update }: DeckCustomizerProps) {
  const sym = currencySymbol(customization.currency);
  return (
    <>
      <Field label={`Total deck budget (${customization.currency})`}>
        <PresetEditableNumber
          value={customization.deckBudget}
          presets={[null, 25, 50, 100, 200]}
          formatPreset={(v) => (v === null ? 'None' : `${sym}${v}`)}
          formatCustom={(v) => `${sym}${v}`}
          onChange={(n) => update({ deckBudget: n })}
          ariaLabel="Custom total deck budget"
        />
      </Field>
      <Field label={`Max card price (${customization.currency})`}>
        <PresetEditableNumber
          value={customization.maxCardPrice}
          presets={[null, 1, 5, 10, 25]}
          formatPreset={(v) => (v === null ? 'None' : `${sym}${v}`)}
          formatCustom={(v) => `${sym}${v}`}
          onChange={(n) => update({ maxCardPrice: n })}
          ariaLabel="Custom max card price"
        />
      </Field>
      <Toggle
        label="Owned cards do not count toward budget"
        checked={customization.ignoreOwnedBudget}
        onChange={(v) => update({ ignoreOwnedBudget: v })}
      />
    </>
  );
}

// ── EDHREC pool / rarity / game changers / combos ────────────────────────
function PoolGroup({ customization, update }: DeckCustomizerProps) {
  return (
    <>
      <Field label="EDHREC card pool">
        <OptionGrid<BudgetOption>
          value={customization.budgetOption}
          options={[
            { value: 'any', label: 'Any', sublabel: 'All cards' },
            { value: 'budget', label: 'Budget', sublabel: 'Cheaper picks' },
            { value: 'expensive', label: 'Expensive', sublabel: 'Premium picks' },
          ]}
          onChange={(v) => update({ budgetOption: v })}
        />
      </Field>

      <Field
        label="Max card rarity"
        hint="Cards in your collection bypass this cap when the toggle below is on."
      >
        <OptionGrid<MaxRarity | 'all'>
          value={customization.maxRarity ?? 'all'}
          options={[
            { value: 'all', label: 'All' },
            { value: 'common', label: 'Common' },
            { value: 'uncommon', label: 'Uncommon' },
            { value: 'rare', label: 'Rare' },
            { value: 'mythic', label: 'Mythic' },
          ]}
          onChange={(v) => update({ maxRarity: v === 'all' ? null : v })}
        />
      </Field>
      {customization.maxRarity != null && (
        <Toggle
          label="Owned cards skip rarity limit"
          checked={customization.ignoreOwnedRarity}
          onChange={(v) => update({ ignoreOwnedRarity: v })}
        />
      )}

      <Field label="Game changers" hint="EDHREC-flagged high-impact cards.">
        <GameChangerOptions
          value={customization.gameChangerLimit}
          onChange={(v) => update({ gameChangerLimit: v })}
        />
      </Field>

      <Field label="Combos">
        <OptionGrid<number>
          value={customization.comboCount}
          options={[
            { value: 0, label: 'None' },
            { value: 1, label: 'Normal' },
            { value: 2, label: 'A few extra' },
            { value: 3, label: 'Many' },
          ]}
          onChange={(v) => update({ comboCount: v })}
        />
      </Field>

      <Toggle
        label="Arena only"
        hint="Only cards playable on MTG Arena."
        checked={customization.arenaOnly}
        onChange={(v) => update({ arenaOnly: v })}
      />
      <Toggle
        label="Tiny Leaders"
        hint="Caps every non-land card at mana value 3."
        checked={customization.tinyLeaders}
        onChange={(v) => update({ tinyLeaders: v })}
      />
    </>
  );
}

// ── Ban lists — live Scryfall presets (banned:<format>) ──────────────────
const BAN_PRESETS = [
  { format: 'commander', label: 'Commander' },
  { format: 'brawl', label: 'Brawl' },
  { format: 'standardbrawl', label: 'Standard Brawl' },
  { format: 'paupercommander', label: 'Pauper EDH' },
];

function BanListsGroup({ customization, update }: DeckCustomizerProps) {
  const lists = customization.banLists ?? [];
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (format: string, label: string) => {
    setError(null);
    if (lists.some((l) => l.id === format)) {
      update({ banLists: lists.filter((l) => l.id !== format) });
      return;
    }
    setLoading(format);
    try {
      const cards = await getBanList(format);
      if (cards.length === 0) throw new Error('empty ban list');
      update({
        banLists: [...lists, { id: format, name: label, cards, isPreset: true, enabled: true }],
      });
    } catch {
      setError(`Couldn't load the ${label} ban list. Check your connection and try again.`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      <p className="deck-customizer-hint">
        Pulled live from Scryfall. Every card banned in the format is excluded from generation, on
        top of your own excluded cards.
      </p>
      <div className="ban-preset-row">
        {BAN_PRESETS.map(({ format, label }) => {
          const applied = lists.find((l) => l.id === format);
          const busy = loading === format;
          return (
            <button
              key={format}
              type="button"
              className={`preset-pill${applied ? ' active' : ''}`}
              aria-pressed={!!applied}
              aria-busy={busy}
              disabled={loading !== null}
              onClick={() => toggle(format, label)}
            >
              {busy ? 'Loading…' : applied ? `${label} (${applied.cards.length})` : label}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="deck-customizer-hint" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

// ── Game changers — None / Custom (click to edit) / Unlimited ────────────
function GameChangerOptions({
  value,
  onChange,
}: {
  value: GameChangerLimit;
  onChange: (v: GameChangerLimit) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const isCustom = typeof value === 'number';
  const commit = () => {
    setEditing(false);
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n) && n >= 0) onChange(n);
  };

  return (
    <div className="option-grid option-grid-3">
      <button
        type="button"
        className={`option-card${value === 'none' ? ' active' : ''}`}
        onClick={() => onChange('none')}
      >
        <span className="option-card-label">None</span>
        <span className="option-card-sublabel">No game changers</span>
      </button>
      {editing ? (
        <div className="option-card option-card-editing">
          <input
            ref={inputRef}
            className="option-card-input"
            type="number"
            min={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <span className="option-card-sublabel">max count</span>
        </div>
      ) : (
        <button
          type="button"
          className={`option-card${isCustom ? ' active' : ''}`}
          onClick={() => {
            setDraft(isCustom ? String(value) : '3');
            setEditing(true);
          }}
        >
          <span className="option-card-label">{isCustom ? `Up to ${value}` : 'Custom'}</span>
          <span className="option-card-sublabel">Set a limit</span>
        </button>
      )}
      <button
        type="button"
        className={`option-card${value === 'unlimited' ? ' active' : ''}`}
        onClick={() => onChange('unlimited')}
      >
        <span className="option-card-label">Unlimited</span>
        <span className="option-card-sublabel">No restriction</span>
      </button>
    </div>
  );
}

// ── Tempo ─────────────────────────────────────────────────────────────────
function TempoGroup({ customization, update }: DeckCustomizerProps) {
  const pacings = (Object.entries(PACING_LABELS) as [Pacing, string][]).map(([value, label]) => ({
    value,
    label,
  }));
  return (
    <>
      <p
        style={{
          margin: '0 0 0.75rem',
          fontSize: '0.85em',
          lineHeight: 1.4,
          opacity: 0.75,
        }}
      >
        Tempo shapes the mana curve and play pattern — aggressive decks load up on cheap threats,
        late-game decks lean on big payoffs. Auto-detect picks a profile from{' '}
        <a
          href="https://edhrec.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit', textDecoration: 'underline' }}
          onClick={(e) => {
            if (!isNativePlatform()) return;
            e.preventDefault();
            openExternal('https://edhrec.com');
          }}
        >
          EDHREC
        </a>
        &apos;s stats for your commander.
      </p>
      <Toggle
        label="Auto-detect from EDHREC stats"
        checked={customization.tempoAutoDetect}
        onChange={(v) => update({ tempoAutoDetect: v })}
      />
      <Field label="Pacing">
        <OptionGrid<Pacing>
          value={customization.tempoPacing}
          disabled={customization.tempoAutoDetect}
          options={pacings}
          onChange={(v) => update({ tempoPacing: v })}
        />
      </Field>
    </>
  );
}

// ── Scryfall query ────────────────────────────────────────────────────────
function ScryfallGroup({ customization, update }: DeckCustomizerProps) {
  return (
    <Field
      label="Additional Scryfall query"
      hint="Appended to every card-pool query."
      align="stretch"
    >
      <input
        type="text"
        className="deck-customizer-text-input"
        value={customization.scryfallQuery}
        placeholder="e.g. -is:reprint or set:mkm"
        onChange={(e) => update({ scryfallQuery: e.target.value })}
      />
    </Field>
  );
}

// ── Card name pickers (must-include / excluded) ──────────────────────────
function CardListGroup({
  hint,
  values,
  onChange,
  fetcher,
}: {
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
  fetcher?: (query: string) => Promise<string[]>;
}) {
  return (
    <>
      <p className="deck-customizer-hint">{hint}</p>
      <CardNameAutocomplete
        fetcher={fetcher}
        onPick={(name) => {
          if (values.includes(name)) return;
          onChange([...values, name]);
        }}
      />
      {values.length > 0 && (
        <ul className="deck-customizer-pills">
          {values.map((name) => (
            <li key={name} className="deck-customizer-pill">
              <span className="card-name-chip-text" title={name}>
                {name}
              </span>
              <button
                type="button"
                className="deck-customizer-pill-remove"
                aria-label={`Remove ${name}`}
                onClick={() => onChange(values.filter((v) => v !== name))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CardNameAutocomplete({
  onPick,
  fetcher = autocompleteCardName,
}: {
  onPick: (name: string) => void;
  fetcher?: (query: string) => Promise<string[]>;
}) {
  const [input, setInput] = useState('');
  // Card-name autocomplete returns plain name strings, not full cards — the
  // shared search hook drives the debounce/loading/cancellation via a custom fetcher.
  const { results: suggestions, loading } = useSearchCards<string>(input, {
    fetcher,
    debounceMs: 200,
    limit: 8,
  });

  const handlePick = (name: string) => {
    onPick(name);
    setInput('');
  };

  return (
    <div className="deck-customizer-autocomplete">
      <SearchPill
        inputType="text"
        className="deck-customizer-autocomplete-input"
        placeholder="Search cards…"
        ariaLabel="Search cards to add"
        value={input}
        onChange={setInput}
        inputProps={{
          onKeyDown: (e) => {
            if (e.key === 'Enter' && suggestions[0]) {
              e.preventDefault();
              handlePick(suggestions[0]);
            }
          },
        }}
      />
      {input.trim().length >= 2 && (
        <ul className="deck-customizer-autocomplete-list">
          {loading && <li className="deck-customizer-autocomplete-empty">Searching…</li>}
          {!loading && suggestions.length === 0 && (
            <li className="deck-customizer-autocomplete-empty">No matches</li>
          )}
          {suggestions.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="deck-customizer-autocomplete-item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handlePick(name);
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────

/** Wrap a control with a centered label above it (and an optional hint below). */
function Field({
  label,
  hint,
  align = 'center',
  children,
}: {
  label: string;
  hint?: string;
  align?: 'center' | 'stretch';
  children: React.ReactNode;
}) {
  return (
    <div className={`deck-customizer-field deck-customizer-field-${align}`}>
      <span className="deck-customizer-field-label">{label}</span>
      <div className="deck-customizer-field-control">{children}</div>
      {hint && <small className="deck-customizer-field-hint">{hint}</small>}
    </div>
  );
}

interface OptionGridItem<T> {
  value: T;
  label: string;
  sublabel?: string;
}

/** Pill-card grid of mutually-exclusive options. Replaces small-N <select>s. */
function OptionGrid<T extends string | number | null>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: OptionGridItem<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  // Radios group by shared `name` — every OptionGrid on the page needs its own,
  // or they'd all be one group and deselect each other.
  const group = useId();
  return (
    <fieldset
      className={`option-grid option-grid-${Math.min(5, options.length)}`}
      disabled={disabled}
    >
      {options.map((opt) => (
        <label
          key={String(opt.value)}
          className={`option-card${value === opt.value ? ' active' : ''}`}
        >
          <input
            type="radio"
            name={group}
            value={String(opt.value)}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
          />
          <span className="option-card-label">{opt.label}</span>
          {opt.sublabel && <span className="option-card-sublabel">{opt.sublabel}</span>}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Preset row + Custom click-to-edit numeric input. `null` is treated as "no
 * limit" / unset; selecting it commits null upstream.
 */
function PresetEditableNumber({
  value,
  presets,
  formatPreset,
  formatCustom,
  onChange,
  ariaLabel,
}: {
  value: number | null;
  presets: (number | null)[];
  formatPreset: (v: number | null) => string;
  formatCustom: (v: number) => string;
  onChange: (n: number | null) => void;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const isPreset = presets.some((p) => p === value);
  const showCustomActive = value !== null && !isPreset;

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v === '') return;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) onChange(n);
  };

  return (
    <div className="preset-row">
      {presets.map((p) => {
        const active = value === p;
        return (
          <button
            key={p === null ? 'none' : String(p)}
            type="button"
            aria-pressed={active}
            className={`preset-pill${active ? ' active' : ''}${p === null && active ? ' preset-pill-none' : ''}`}
            onClick={() => {
              setEditing(false);
              onChange(p);
            }}
          >
            {formatPreset(p)}
          </button>
        );
      })}
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          min={0}
          step="0.01"
          className="preset-pill preset-pill-input"
          aria-label={ariaLabel}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button
          type="button"
          aria-pressed={showCustomActive}
          className={`preset-pill${showCustomActive ? ' active' : ''}`}
          onClick={() => {
            setDraft(value !== null && !isPreset ? String(value) : '');
            setEditing(true);
          }}
        >
          {showCustomActive ? formatCustom(value!) : 'Custom'}
        </button>
      )}
    </div>
  );
}

/** Themed checkbox row used by the customizer. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="field-checkbox deck-customizer-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <small className="deck-customizer-toggle-hint">{hint}</small>}
      </span>
    </label>
  );
}

/** Range slider with archetype anchors and a current-value chip. */
function RangeSlider({
  label,
  ariaLabel,
  value,
  min,
  max,
  onChange,
  anchors,
  valueSuffix,
  suggested,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  anchors: { value: number; label: string }[];
  valueSuffix?: string;
  suggested?: boolean;
}) {
  return (
    <div className="deck-customizer-slider">
      <div className="deck-customizer-slider-header">
        <span className="deck-customizer-slider-label">
          {label}
          {suggested && (
            <span
              className="deck-customizer-slider-suggested"
              aria-label="Matches EDHREC suggestion"
            >
              <Check width={12} height={12} strokeWidth={3} aria-hidden />
              suggested
            </span>
          )}
        </span>
        <span className="deck-customizer-slider-value">
          {value}
          {valueSuffix && (
            <span className="deck-customizer-slider-value-suffix"> {valueSuffix}</span>
          )}
        </span>
      </div>
      <input
        type="range"
        className="deck-customizer-range"
        min={min}
        max={max}
        value={Math.max(min, Math.min(max, value))}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          ['--range-progress' as string]: `${
            max === min ? 0 : ((Math.max(min, Math.min(max, value)) - min) / (max - min)) * 100
          }%`,
        }}
      />
      <div className="deck-customizer-slider-anchors">
        {anchors.map((a, i) => (
          <span
            key={`${a.value}-${i}`}
            className="deck-customizer-slider-anchor"
            data-align={i === 0 ? 'start' : i === anchors.length - 1 ? 'end' : 'center'}
          >
            <span className="deck-customizer-slider-anchor-value">{a.value}</span>{' '}
            <span className="deck-customizer-slider-anchor-label">({a.label})</span>
          </span>
        ))}
      </div>
    </div>
  );
}
