import './PowerHero.css';
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { bracketLabel } from '@/deck-builder/services/deckBuilder/bracketEstimator';

export interface PowerHeroProps {
  /** Override-aware bracket number (1–5), or null when not yet estimated. */
  bracket: number | null;
  /** True when the bracket is a manual override rather than the auto estimate. */
  bracketOverridden: boolean;
  /** Pre-formatted hard-floor reasons (top 3 are shown). */
  bracketReasons: string[];
  /** Primary synergy axis label, e.g. "Tokens / go-wide". */
  engineLabel?: string;
  /** Producer count for the primary axis. */
  engineProducers?: number;
  /** Payoff count for the primary axis. */
  enginePayoffs?: number;
  /** True when the synergy analysis flagged a lopsided engine. */
  engineLopsided?: boolean;
  comboInDeck: number;
  comboOneAway: number;
  /** One-away combos whose missing piece the user already owns. */
  comboOwnedMissing: number;
  combosLoading: boolean;
}

/**
 * The Power-tab verdict hero: a two-pillar summary that leads with how strong a
 * deck is (Power level, self-explained via its bracket floors) and what it does
 * (Gameplan — the primary engine + combo counts), plus a collection-aware chip
 * when the user owns the missing piece for a one-away combo. Purely
 * presentational — every value maps to an existing field, computed by the page.
 */
export function PowerHero({
  bracket,
  bracketOverridden,
  bracketReasons,
  engineLabel,
  engineProducers,
  enginePayoffs,
  engineLopsided,
  comboInDeck,
  comboOneAway,
  comboOwnedMissing,
  combosLoading,
}: PowerHeroProps): JSX.Element {
  const producers = engineProducers ?? 0;
  const payoffs = enginePayoffs ?? 0;
  const engineBalanced = producers > 0 && payoffs > 0 && !engineLopsided;
  const showReasons = !bracketOverridden && bracketReasons.length > 0;
  const showCollection = !combosLoading && comboOwnedMissing > 0;

  return (
    <section className="power-hero" aria-label="Deck power summary">
      <div className="power-hero-pillars">
        {/* ── Power level ── */}
        <div className="power-hero-pillar">
          <span className="power-hero-eyebrow">Power level</span>
          <p className="power-hero-bracket">
            {bracket != null ? (
              <>
                Bracket <strong className="power-hero-bracket-num">{bracket}</strong> ·{' '}
                {bracketLabel(bracket)}
              </>
            ) : (
              <>Bracket —</>
            )}
            {bracketOverridden && <span className="power-hero-tag">manual</span>}
          </p>
          {showReasons && (
            <p className="power-hero-because">because: {bracketReasons.slice(0, 3).join(', ')}</p>
          )}
        </div>

        {/* ── Gameplan ── */}
        <div className="power-hero-pillar">
          <span className="power-hero-eyebrow">Gameplan</span>
          {engineLabel ? (
            <p className="power-hero-engine">
              <span className="power-hero-engine-label">{engineLabel}</span>
              <span className="power-hero-engine-counts">
                {producers} prod · {payoffs} payoff
              </span>
              {engineLopsided ? (
                <span className="power-hero-lopsided">
                  <AlertTriangle className="power-hero-warn-icon" aria-hidden="true" />
                  lopsided
                </span>
              ) : (
                engineBalanced && (
                  <span className="power-hero-balanced" aria-hidden="true">
                    ✓
                  </span>
                )
              )}
            </p>
          ) : (
            <p className="power-hero-muted">No dominant engine yet</p>
          )}
          {combosLoading ? (
            <p className="power-hero-combos is-loading" aria-live="polite">
              <Loader2 className="power-hero-spinner" aria-hidden="true" />
              Checking for combos…
            </p>
          ) : (
            <p className="power-hero-combos">
              {comboInDeck} in deck · {comboOneAway} one away
            </p>
          )}
        </div>
      </div>

      {showCollection && (
        <p className="power-hero-collection">
          <Sparkles className="power-hero-collection-icon" aria-hidden="true" />
          You own the missing piece for {comboOwnedMissing}{' '}
          {comboOwnedMissing === 1 ? 'combo' : 'combos'} you&rsquo;re one away from.
        </p>
      )}
    </section>
  );
}
