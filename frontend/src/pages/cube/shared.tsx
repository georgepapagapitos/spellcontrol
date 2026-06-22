import { useMemo } from 'react';
import { MeterBar } from '../../components/shared/MeterBar';
import { OwnershipBadge } from '../../components/deck/OwnershipBadge';
import { VerdictBadge } from '../../components/deck/VerdictBadge';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useCubeStore } from '../../store/cube';
import { buildAllocationMap } from '../../lib/allocations';
import type { ColorBucket } from '../../lib/cube/targets';
import type { GeneratedCube } from '../../lib/cube/generate';
import type { Ownership } from '../../lib/cube/import';

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
