import type { JSX } from 'react';
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
  /** One-away combos whose missing piece the user already owns (completable). */
  comboOwnedMissing: number;
  combosLoading: boolean;
  /** Reveal the Bracket panel below. When omitted, the bracket line is static. */
  onViewBracket?: () => void;
  /** Reveal the Engine panel below. When omitted, the engine line is static. */
  onViewEngine?: () => void;
  /** Reveal the Combos panel below. When omitted, the combo line is static. */
  onViewCombos?: () => void;
  /** One-line win-condition summary, e.g. "Wins via Infinite combo · backup: Mill". */
  winConditionSummary?: string;
  /** True when noClearWinCondition — renders a warn tone instead of normal text. */
  winConditionWarn?: boolean;
  /** Reveal the Win conditions panel below. When omitted, the line is static. */
  onViewWinConditions?: () => void;
}

/** A "go to detail" affordance: a typographic chevron in the surrounding font
 *  (congruent + baseline-aligned), tinted with the app's interactive accent.
 *  Spacing comes from the flex `gap` in the bracket/combo lines and from an
 *  explicit space in the inline engine label. */
function LinkChevron(): JSX.Element {
  return (
    <span className="power-hero-link-chevron" aria-hidden="true">
      {'›'}
    </span>
  );
}

/**
 * A hero summary line. When `onClick` is provided it renders as a tappable
 * button (full-row hover/tap target) that jumps to the matching detail panel
 * below; otherwise it's static text in `as`. The chevron lives in `children`
 * (caller-placed, gated on the callback) so it sits inline with the right line.
 */
function HeroLink({
  onClick,
  ariaLabel,
  contentClassName,
  as: Tag = 'p',
  children,
}: {
  onClick?: () => void;
  ariaLabel: string;
  contentClassName: string;
  as?: 'p' | 'div';
  children: React.ReactNode;
}): JSX.Element {
  if (!onClick) {
    return <Tag className={contentClassName}>{children}</Tag>;
  }
  return (
    <button type="button" className="power-hero-link" onClick={onClick} aria-label={ariaLabel}>
      <span className={contentClassName}>{children}</span>
    </button>
  );
}

/**
 * The Power-tab verdict hero: a two-pillar summary that leads with how strong a
 * deck is (Power level, self-explained via its bracket floors) and what it does
 * (Gameplan — the primary engine + combo counts), plus a collection-aware chip
 * when the user owns the missing piece for a one-away combo. Each pillar line
 * can deep-link (tap to reveal) the matching detail panel below; values map to
 * existing fields computed by the page.
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
  comboOwnedMissing,
  combosLoading,
  onViewBracket,
  onViewEngine,
  onViewCombos,
  winConditionSummary,
  winConditionWarn,
  onViewWinConditions,
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
          <HeroLink
            onClick={onViewBracket}
            ariaLabel="View bracket details"
            contentClassName="power-hero-bracket"
          >
            {bracket != null ? (
              <>
                Bracket <strong className="power-hero-bracket-num">{bracket}</strong> ·{' '}
                {bracketLabel(bracket)}
              </>
            ) : (
              <>Bracket —</>
            )}
            {bracketOverridden && <span className="power-hero-tag">manual</span>}
            {onViewBracket && <LinkChevron />}
          </HeroLink>
          {showReasons && (
            <p className="power-hero-because">because: {bracketReasons.slice(0, 3).join(', ')}</p>
          )}
        </div>

        {/* ── Gameplan ── */}
        <div className="power-hero-pillar">
          <span className="power-hero-eyebrow">Gameplan</span>
          {engineLabel ? (
            <HeroLink
              onClick={onViewEngine}
              ariaLabel="View engine details"
              contentClassName="power-hero-engine"
              as="div"
            >
              <span className="power-hero-engine-label">
                {engineLabel}
                {onViewEngine && (
                  <>
                    {' '}
                    <LinkChevron />
                  </>
                )}
              </span>
              <span className="power-hero-engine-verdict">
                {engineLopsided ? (
                  <span className="power-hero-lopsided">
                    <AlertTriangle className="power-hero-warn-icon" aria-hidden="true" />
                    Lopsided
                  </span>
                ) : engineBalanced ? (
                  <span className="power-hero-balanced">Balanced engine</span>
                ) : null}
                {(engineLopsided || engineBalanced) && (
                  <span className="power-hero-engine-sep" aria-hidden="true">
                    ·
                  </span>
                )}
                <span className="power-hero-engine-counts">
                  {producers} {producers === 1 ? 'enabler' : 'enablers'}, {payoffs}{' '}
                  {payoffs === 1 ? 'payoff' : 'payoffs'}
                </span>
              </span>
            </HeroLink>
          ) : (
            <p className="power-hero-muted">No dominant engine yet</p>
          )}
          {combosLoading ? (
            <p className="power-hero-combos is-loading" aria-live="polite">
              <Loader2 className="power-hero-spinner" aria-hidden="true" />
              Checking for combos…
            </p>
          ) : (
            <HeroLink
              onClick={onViewCombos}
              ariaLabel="View combos"
              contentClassName="power-hero-combos"
            >
              {comboInDeck} {comboInDeck === 1 ? 'combo' : 'combos'} in deck ·{' '}
              {comboOwnedMissing > 0
                ? `${comboOwnedMissing} you can complete`
                : 'none you can complete now'}
              {onViewCombos && <LinkChevron />}
            </HeroLink>
          )}
          {winConditionSummary && (
            <HeroLink
              onClick={onViewWinConditions}
              ariaLabel="View win conditions"
              contentClassName={`power-hero-wincon${winConditionWarn ? ' power-hero-wincon--warn' : ''}`}
            >
              {winConditionWarn && (
                <AlertTriangle
                  className="power-hero-warn-icon"
                  width={12}
                  height={12}
                  aria-hidden
                />
              )}{' '}
              {winConditionSummary}
              {onViewWinConditions && <LinkChevron />}
            </HeroLink>
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
