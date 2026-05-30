import './HeroScore.css';
import type { PlanScore } from '@/deck-builder/services/deckBuilder/planScore';

/** Band tier for a 0-100 score → drives the ring/text color class. */
function bandClass(value: number): string {
  if (value >= 75) return 'is-emerald';
  if (value >= 60) return 'is-accent';
  if (value >= 40) return 'is-amber';
  return 'is-rose';
}

export interface HeroScoreProps {
  plan: PlanScore;
}

/**
 * PlanScore hero gauge: a circular ring showing the overall 0-100 score,
 * tinted by band, with the band label, headline, and byline beside it. Purely
 * presentational — all copy and numbers come from the `plan` prop.
 */
export function HeroScore({ plan }: HeroScoreProps): JSX.Element {
  const { overall, bandLabel, headline, byline, limitedData } = plan;
  const clamped = Math.max(0, Math.min(100, Math.round(overall)));
  const band = bandClass(clamped);

  return (
    <section
      className={`hero-score ${band}`}
      role="group"
      aria-label={`Plan score ${clamped} out of 100, ${bandLabel}`}
    >
      <div
        className="hero-score-ring"
        aria-hidden="true"
        style={{ ['--hero-score-pct' as string]: clamped }}
      >
        <div className="hero-score-ring-hole">
          <span className="hero-score-value">{clamped}</span>
          <span className="hero-score-band">{bandLabel}</span>
        </div>
      </div>
      <div className="hero-score-copy">
        <p className="hero-score-headline">{headline}</p>
        <p className="hero-score-byline">{byline}</p>
        {limitedData && (
          <p className="hero-score-limited">
            <span className="hero-score-limited-dot" aria-hidden="true" />
            Limited data — score may shift as the deck fills out.
          </p>
        )}
      </div>
    </section>
  );
}
