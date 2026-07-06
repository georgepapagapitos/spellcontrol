import { useMemo, type JSX } from 'react';
import './BrewManabaseStep.css';
import '@/styles/deck-builder-skeleton.css';
import { useCardThumb } from '@/lib/card-thumbs';
import { useBrewStore } from '@/deck-builder/store/brew';
import type { ScryfallCard } from '@/deck-builder/types';

interface TalliedLand {
  name: string;
  count: number;
  isBasic: boolean;
}

function tallyLands(lands: ScryfallCard[]): TalliedLand[] {
  const byName = new Map<string, TalliedLand>();
  for (const land of lands) {
    const isBasic = (land.type_line ?? '').toLowerCase().includes('basic land');
    const existing = byName.get(land.name);
    if (existing) existing.count += 1;
    else byName.set(land.name, { name: land.name, count: 1, isBasic });
  }
  return [...byName.values()].sort((a, b) => {
    if (a.isBasic !== b.isBasic) return a.isBasic ? 1 : -1;
    return b.count - a.count;
  });
}

function LandThumb({ name }: { name: string }): JSX.Element {
  const url = useCardThumb(name, 'small');
  return url ? (
    <img src={url} alt="" loading="lazy" />
  ) : (
    <span className="brew-land-thumb-ph" aria-hidden />
  );
}

function ManabaseSkeleton(): JSX.Element {
  return (
    <ul className="brew-land-skeleton" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="deck-analysis-skeleton-bar is-body" />
      ))}
    </ul>
  );
}

interface BrewManabaseStepProps {
  onAccept: () => void;
}

/** The final review step: the computed manabase as one reviewable list
 * (accept-all, or tweak the total count and regenerate) — never a
 * card-by-card land pick. */
export function BrewManabaseStep({ onAccept }: BrewManabaseStepProps): JSX.Element {
  const landPlan = useBrewStore((s) => s.landPlan);
  const landPlanLoading = useBrewStore((s) => s.landPlanLoading);
  const landPlanError = useBrewStore((s) => s.landPlanError);
  const landCountTarget = useBrewStore((s) => s.landCountTarget);
  const setLandCountTarget = useBrewStore((s) => s.setLandCountTarget);
  const goToManabase = useBrewStore((s) => s.goToManabase);

  const tallied = useMemo(() => tallyLands(landPlan ?? []), [landPlan]);
  const totalLands = landPlan?.length ?? 0;

  return (
    <section className="brew-manabase" aria-labelledby="brew-manabase-heading">
      <header className="brew-slot-header">
        <h2 id="brew-manabase-heading">Manabase</h2>
        <p className="brew-slot-purpose">
          Your commander's colors, built into a land base — nonbasics EDHREC players actually run,
          then basics split to match your color pips. Review it, tweak the count, or take it as-is.
        </p>
      </header>

      <div className="brew-land-count-control">
        <label htmlFor="brew-land-count">Total lands</label>
        <input
          id="brew-land-count"
          type="number"
          min={30}
          max={50}
          value={landCountTarget}
          disabled={landPlanLoading}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) void setLandCountTarget(n);
          }}
        />
      </div>

      {landPlanLoading ? (
        <ManabaseSkeleton />
      ) : landPlanError ? (
        <div className="brew-land-error">
          <p>{landPlanError}</p>
          <button type="button" className="btn" onClick={() => void goToManabase()}>
            Retry
          </button>
        </div>
      ) : (
        <ul className="brew-land-list">
          {tallied.map((land) => (
            <li key={land.name} className="brew-land-row">
              <LandThumb name={land.name} />
              <span className="brew-land-name">{land.name}</span>
              <span className="brew-land-count">×{land.count}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="brew-slot-nav">
        <span className="brew-land-total">{totalLands} lands total</span>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onAccept}
          disabled={landPlanLoading || !landPlan}
        >
          Looks good — save my deck →
        </button>
      </div>
    </section>
  );
}
