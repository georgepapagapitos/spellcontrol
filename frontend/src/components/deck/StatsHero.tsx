import type { JSX } from 'react';
import { ArrowRight } from 'lucide-react';
import './StatsHero.css';
import type { SubScoreKey, PlanScore } from '@/deck-builder/services/deckBuilder/planScore';
import {
  summarizeValidation,
  type ValidationResult,
  type ValidationTone,
} from '@/deck-builder/services/deckBuilder/validationChecklist';
import type { LaneId } from '@/lib/deck-change';

export interface StatsHeroProps {
  /** The deck-health checklist roll-up (legality + role/curve gates). */
  validation: ValidationResult;
  /** The build-quality plan score, or null when not yet analysed (non-commander/pre-analysis). */
  planScore: PlanScore | null;
  /**
   * Deep-link to a Tune lane from a shortfall line. When omitted, shortfalls
   * are inert text (non-commander decks, no analysis yet).
   */
  onNavigate?: (lane: LaneId) => void;
}

/** Verdict glyph per tone — mirrors the checklist's status glyphs (pass/warn/fail). */
const TONE_GLYPH: Record<ValidationTone, string> = { success: '✓', warn: '▾', err: '✗' };

/** Friendly, title-cased labels for the plan sub-score keys (for the soft-spot line). */
const SUBSCORE_LABEL: Record<SubScoreKey, string> = {
  strategy: 'Strategy',
  roles: 'Roles',
  curve: 'Curve',
  cardFit: 'Card fit',
};

/** Up to this many shortfalls are named inline before collapsing to "+k more". */
const MAX_SHORTFALLS = 3;

/**
 * Map a failing/warning validation check id to the Tune lane that can fix it.
 * Hard-rule ids (size / identity / singleton) are excluded — those require card
 * edits in the Deck view, not the Tune suggestions lane.
 */
const CHECK_TO_LANE: Record<string, LaneId> = {
  ramp: 'fill-gaps',
  removal: 'fill-gaps',
  cardDraw: 'fill-gaps',
  boardwipe: 'fill-gaps',
  curve: 'fill-gaps',
};

/**
 * The Stats-tab verdict hero: a two-pillar summary that leads with the tab's one
 * question — *is the deck functional?* The Functional pillar rolls the validation
 * checklist up into one tone-led verdict (legal + complete, with shortfalls named
 * inline); the Build health pillar surfaces the plan score's overall band, its
 * one-liner, and the weakest sub-score as the soft spot. Purely presentational —
 * every value maps to an existing field on `validation` / `planScore`. When there
 * is no plan score the Functional pillar stands alone, full-width.
 */
export function StatsHero({ validation, planScore, onNavigate }: StatsHeroProps): JSX.Element {
  const verdict = summarizeValidation(validation);

  // Failing/warning checks — each may deep-link to the Tune lane that fixes it.
  const shortfallChecks = validation.checks.filter(
    (c) => c.status === 'warn' || c.status === 'fail'
  );
  const namedChecks = shortfallChecks.slice(0, MAX_SHORTFALLS);
  const extraShortfalls = shortfallChecks.length - namedChecks.length;

  // Weakest sub-score over the non-partial entries (partial ones aren't comparable).
  const softSpot = planScore ? weakestSubscore(planScore) : null;

  return (
    <section className="stats-hero" aria-label="Deck functional summary">
      <div className={`stats-hero-pillars${planScore ? '' : ' is-solo'}`}>
        {/* ── Functional verdict ── */}
        <div className="stats-hero-pillar">
          <span className="stats-hero-eyebrow">Functional</span>
          <p className={`stats-hero-verdict is-${verdict.tone}`}>
            <span className="stats-hero-verdict-glyph" aria-hidden="true">
              {TONE_GLYPH[verdict.tone]}
            </span>
            <strong className="stats-hero-verdict-label">{verdict.label}</strong>
          </p>
          <p className="stats-hero-ratio">
            {validation.passCount} of {validation.total} checks pass
          </p>
          {namedChecks.length > 0 && (
            <ul className="stats-hero-shortfall-list" aria-label="Issues to address">
              {namedChecks.map((check) => {
                const lane = CHECK_TO_LANE[check.id];
                const label = `${check.label} ${check.detail}`;
                return (
                  <li key={check.id} className="stats-hero-shortfall-item">
                    {onNavigate && lane ? (
                      <button
                        type="button"
                        className="stats-hero-shortfall-btn"
                        onClick={() => onNavigate(lane)}
                        aria-label={`${label} — go to Tune`}
                      >
                        <span className="stats-hero-shortfall-text">{label}</span>
                        <ArrowRight
                          className="stats-hero-shortfall-arrow"
                          aria-hidden="true"
                          width={12}
                          height={12}
                        />
                      </button>
                    ) : (
                      <span className="stats-hero-shortfall-text">{label}</span>
                    )}
                  </li>
                );
              })}
              {extraShortfalls > 0 && (
                <li className="stats-hero-shortfall-item stats-hero-shortfall-more">
                  +{extraShortfalls} more
                </li>
              )}
            </ul>
          )}
        </div>

        {/* ── Build health ── */}
        {planScore && (
          <div className="stats-hero-pillar">
            <span className="stats-hero-eyebrow">Build health</span>
            <p className="stats-hero-band">
              <strong className="stats-hero-band-num">{planScore.overall}</strong> ·{' '}
              {planScore.bandLabel}
              {planScore.limitedData && <span className="stats-hero-limited"> · limited data</span>}
            </p>
            <p className="stats-hero-headline">{planScore.headline}</p>
            {softSpot && (
              <p className="stats-hero-softspot">
                soft spot: {SUBSCORE_LABEL[softSpot.key]} — {softSpot.bandLabel}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Pick the weakest plan sub-score — the min `value` over the non-partial entries.
 * Returns null when every sub-score is partial (nothing comparable to call out).
 */
function weakestSubscore(plan: PlanScore): { key: SubScoreKey; bandLabel: string } | null {
  let weakest: { key: SubScoreKey; value: number; bandLabel: string } | null = null;
  for (const key of Object.keys(plan.subscores) as SubScoreKey[]) {
    const sub = plan.subscores[key];
    if (sub.partial) continue;
    if (weakest === null || sub.value < weakest.value) {
      weakest = { key, value: sub.value, bandLabel: sub.bandLabel };
    }
  }
  return weakest ? { key: weakest.key, bandLabel: weakest.bandLabel } : null;
}
