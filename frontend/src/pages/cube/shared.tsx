import { useMemo, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { MeterBar } from '../../components/shared/MeterBar';
import { OwnershipBadge } from '../../components/deck/OwnershipBadge';
import { VerdictBadge } from '../../components/deck/VerdictBadge';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useCubeStore } from '../../store/cube';
import { buildAllocationMap } from '../../lib/allocations';
import { cubeRole } from '../../deck-builder/services/tagger/client';
import { synergyTags } from '../../lib/cube/synergy-tags';
import { scryfallToEnrichedCard } from '../../lib/scryfall-to-enriched';
import { CUBE_SIZES, SIZE_INFO, type ColorBucket, type CubeSize } from '../../lib/cube/targets';
import type { GeneratedCube, CubeCard } from '../../lib/cube/generate';
import type { Ownership } from '../../lib/cube/import';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../../types';

// Bucket display order, names, and segment colors for the balance bars.
export const BUCKET_ORDER: ColorBucket[] = [
  'W',
  'U',
  'B',
  'R',
  'G',
  'multicolor',
  'colorless',
  'land',
];
export const BUCKET_LABEL: Record<ColorBucket, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  multicolor: 'Multicolor',
  colorless: 'Colorless',
  land: 'Lands',
};
// Fills point at the shared mana-identity tokens (styles/tokens.css) so the cube
// bars and the deck mana-base chart show one palette for five colors.
export const BUCKET_COLOR: Record<ColorBucket, string> = {
  W: 'var(--mtg-w)',
  U: 'var(--mtg-u)',
  B: 'var(--mtg-b)',
  R: 'var(--mtg-r)',
  G: 'var(--mtg-g)',
  multicolor: 'var(--mtg-multicolor)',
  colorless: 'var(--mtg-colorless)',
  land: 'var(--mtg-land)',
};

/**
 * Map unique card names to a `CubeCard[]` pool, preferring Scryfall-enriched data
 * and falling back to the owned collection copy. Shared by the solo and collab
 * build flows (both build the same name→CubeCard pool from their own collection).
 */
export function namesToCubePool(
  names: string[],
  collectionCards: EnrichedCard[],
  enriched: Map<string, ScryfallCard>
): CubeCard[] {
  const ownedByName = new Map<string, EnrichedCard>();
  for (const c of collectionCards)
    if (c.name && !ownedByName.has(c.name)) ownedByName.set(c.name, c);
  return names.map((name) => {
    const card = ownedByName.get(name);
    const s = enriched.get(name);
    return {
      name,
      oracleId: s?.oracle_id ?? card?.oracleId ?? name.toLowerCase(),
      colors: s?.colors ?? card?.colors ?? [],
      cmc: s?.cmc ?? card?.cmc ?? 0,
      typeLine: s?.type_line ?? card?.typeLine ?? '',
      role: cubeRole(name),
      rank: s?.edhrec_rank ?? card?.edhrecRank,
      ...synergyTags(s ?? { name }),
    };
  });
}

/**
 * EnrichedCard for the preview carousel: the cached Scryfall row when available,
 * else a minimal card built from the pick/import row (restored-from-localStorage
 * picks, or import rows with no Scryfall fetch). `image` carries through when set.
 */
export function cubeCardToEnriched(card: {
  name: string;
  oracleId?: string;
  cmc?: number;
  typeLine?: string;
  colors?: string[];
  image?: string;
}): EnrichedCard {
  return {
    copyId: card.oracleId || card.name.toLowerCase(),
    name: card.name,
    setCode: '',
    setName: '',
    collectorNumber: '',
    rarity: '',
    scryfallId: '',
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
    oracleId: card.oracleId,
    cmc: card.cmc,
    typeLine: card.typeLine,
    colorIdentity: card.colors,
    colors: card.colors,
    ...(card.image ? { imageSmall: card.image } : {}),
  };
}

/** Resolve a pick's preview card: cached Scryfall row, else minimal fallback. */
export function pickToPreviewCard(
  card: { name: string; oracleId?: string; cmc?: number; typeLine?: string; colors?: string[] },
  enriched: Map<string, ScryfallCard>
): EnrichedCard {
  const s = enriched.get(card.name);
  return s ? scryfallToEnrichedCard(s) : cubeCardToEnriched(card);
}

/** Group picks into the fixed bucket order, dropping empty buckets, with flat indices. */
export function groupPicksByBucket<P extends { bucket: ColorBucket }>(
  picks: P[]
): { bucket: ColorBucket; items: { pick: P; flatIndex: number }[] }[] {
  const m = new Map<ColorBucket, { pick: P; flatIndex: number }[]>();
  for (const b of BUCKET_ORDER) m.set(b, []);
  picks.forEach((p, flatIndex) => {
    m.get(p.bucket)!.push({ pick: p, flatIndex });
  });
  return BUCKET_ORDER.map((b) => ({ bucket: b, items: m.get(b)! })).filter(
    (g) => g.items.length > 0
  );
}

/** Enter/Space on a focusable cube row opens its preview. */
export function cubeRowKeyDown(e: KeyboardEvent, idx: number, open: (idx: number) => void): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    open(idx);
  }
}

/**
 * Build an `ownershipFor(name)` from the live collection + deck AND physical-cube
 * allocations: 'owned' (a free copy exists), 'in-other-deck' / 'in-cube' (every
 * copy is committed — distinguished so the badge names the right place), or
 * 'unowned'. Deck wins the label when copies are split across both.
 */
export function useOwnershipFor() {
  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const savedCubes = useCubeStore((s) => s.saved);
  return useMemo(() => {
    const allocations = buildAllocationMap(decks, savedCubes);
    const byName = new Map<string, { free: number; deck: number; cube: number }>();
    for (const copy of collectionCards) {
      if (!copy.name) continue;
      const key = copy.name.toLowerCase();
      const e = byName.get(key) ?? { free: 0, deck: 0, cube: 0 };
      const claim = allocations.get(copy.copyId);
      if (!claim) e.free += 1;
      else if (claim.ownerKind === 'cube') e.cube += 1;
      else e.deck += 1;
      byName.set(key, e);
    }
    const ownershipFor = (name: string): Ownership => {
      const e = byName.get(name.toLowerCase());
      if (!e) return 'unowned';
      if (e.free > 0) return 'owned';
      if (e.deck > 0) return 'in-other-deck';
      if (e.cube > 0) return 'in-cube';
      return 'unowned';
    };
    return ownershipFor;
  }, [collectionCards, decks, savedCubes]);
}

/** Ownership chip for a cube row — names where a committed copy actually lives. */
export function OwnRowBadge({ own }: { own: Ownership }) {
  if (own === 'in-other-deck') {
    return (
      <VerdictBadge
        tone="neutral"
        label="In a deck"
        title="You own this, but it’s currently in a deck"
      />
    );
  }
  if (own === 'in-cube') {
    return (
      <VerdictBadge
        tone="neutral"
        label="In a cube"
        title="You own this, but it’s reserved by a physical cube"
      />
    );
  }
  return <OwnershipBadge owned={own === 'owned'} />;
}

/** Readable label for a synergy-slider value. */
function synergyLabel(v: number): string {
  if (v <= 0) return 'Best cards';
  if (v >= 1) return 'Max synergy';
  return `${Math.round(v * 100)}% synergy`;
}

/**
 * Trades raw card power (goodstuff) against archetype synergy when generating a
 * cube. 0 keeps today's pure best-cards selection; higher values prioritise
 * cards that deepen the archetypes your collection can actually support.
 */
export function SynergySlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="cube-synergy">
      <div className="cube-synergy-head">
        <span className="cube-synergy-title">Card priority</span>
        <span className="cube-synergy-val">{synergyLabel(value)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="cube-synergy-range"
        aria-label="Card priority — from best cards to most archetype synergy"
        aria-valuetext={synergyLabel(value)}
      />
      <div className="cube-synergy-ends" aria-hidden="true">
        <span>Best cards</span>
        <span>Synergy</span>
      </div>
    </div>
  );
}

/**
 * Explainable archetype-support panel: the objective's per-axis breakdown plus
 * the overall draftability score. Rendered only when the cube actually fields
 * archetypes (synergy slider engaged → refiner ran).
 */
export function CubeArchetypes({ score }: { score: GeneratedCube['score'] }) {
  if (!score || score.axes.length === 0) return null;
  return (
    <div className="cube-archetypes">
      <div className="cube-archetypes-head">
        <h3>Archetype support</h3>
        <span className="cube-draftability" title="Overall objective score, 0–100">
          <strong>{Math.round(score.total * 100)}</strong>
          <span>draftability</span>
        </span>
      </div>
      <p className="cube-archetypes-sub">
        How deeply a drafter can commit to each strategy your collection supports — balanced
        enablers and payoffs, concentrated in their colors.
      </p>
      <ul className="cube-archetype-list">
        {score.axes.slice(0, 8).map((a) => (
          <li key={a.axis} className="cube-archetype">
            <div className="cube-archetype-row">
              <span className="cube-archetype-name">{a.label}</span>
              <span className="cube-archetype-counts">
                {a.enablers} enabler{a.enablers === 1 ? '' : 's'} · {a.payoffs} payoff
                {a.payoffs === 1 ? '' : 's'}
              </span>
            </div>
            <MeterBar
              value={a.score}
              max={1}
              size="sm"
              role="meter"
              label={`${a.label} draftability`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Empty state shared by the build modes — a message, a CTA link, and a hint. */
export function CubeEmptyState({
  message,
  ctaHref,
  ctaLabel,
  hint,
}: {
  message: string;
  ctaHref: string;
  ctaLabel: string;
  hint: string;
}) {
  return (
    <div className="cube-empty">
      <p>{message}</p>
      <Link to={ctaHref} className="btn btn-primary">
        {ctaLabel}
      </Link>
      <p className="cube-empty-hint">{hint}</p>
    </div>
  );
}

/** The cube-size segmented picker plus its descriptive note. */
export function CubeSizePicker({
  size,
  onSize,
}: {
  size: CubeSize;
  onSize: (s: CubeSize) => void;
}) {
  return (
    <>
      <div className="cube-size-picker" role="group" aria-label="Cube size">
        {CUBE_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            className={`cube-size-opt${s === size ? ' active' : ''}`}
            aria-pressed={s === size}
            onClick={() => onSize(s)}
          >
            <span className="cube-size-n">{s}</span>
            <span className="cube-size-sub">{SIZE_INFO[s].players} players</span>
          </button>
        ))}
      </div>
      <p className="cube-size-note">{SIZE_INFO[size].note}</p>
    </>
  );
}

/** "Available cards only" checkbox — label/title vary per mode. */
export function AvailableToggle({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  title: string;
}) {
  return (
    <label className="field-checkbox cube-available-toggle" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/**
 * The cube generation progress block: a determinate Scryfall-lookup bar while
 * `fetchProgress` is set, otherwise an indeterminate skeleton + finalizing line.
 * `lookupLabel` names the determinate phase (omit for modes with no per-card
 * progress, e.g. import).
 */
export function CubeLoadingBlock({
  fetchProgress,
  lookupLabel = 'Looking up cards',
  finalizingLabel,
}: {
  fetchProgress: { fetched: number; total: number } | null;
  lookupLabel?: string;
  finalizingLabel: string;
}) {
  return (
    <div className="cube-loading" role="status" aria-busy="true">
      {fetchProgress !== null ? (
        <div className="cube-progress">
          <MeterBar
            value={fetchProgress.fetched}
            max={fetchProgress.total}
            size="md"
            role="progressbar"
            label={lookupLabel}
          />
          <p className="cube-loading-text">
            {lookupLabel}… {fetchProgress.fetched.toLocaleString()} /{' '}
            {fetchProgress.total.toLocaleString()}
          </p>
        </div>
      ) : (
        <div className="cube-skeleton">
          <div className="deck-analysis-skeleton-bar is-headline" />
          <div className="deck-analysis-skeleton-bar is-body" />
          <div className="deck-analysis-skeleton-bar is-body is-short" />
        </div>
      )}
      {fetchProgress === null && <p className="cube-loading-text">{finalizingLabel}</p>}
    </div>
  );
}

/** Error alert with a retry action, shared by all build modes. */
export function CubeErrorBlock({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="cube-error" role="alert">
      {error}
      <button type="button" className="btn-link" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
