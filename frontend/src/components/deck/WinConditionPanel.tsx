import { useMemo, type JSX } from 'react';
import './WinConditionPanel.css';
import { AlertTriangle, Hourglass, Trophy } from 'lucide-react';
import type {
  WinConditionAnalysis,
  WinCondition,
} from '@/deck-builder/services/winConditions/types';
import { simulateAssemblyClock } from '@/lib/opening-hand-sim';
import { InfoTip } from '../InfoTip';
import { useCardCarousel, type CarouselEntry } from './useCardCarousel';

export interface WinConditionPanelProps {
  analysis: WinConditionAnalysis;
  /**
   * Mainboard card names (one entry per physical copy, commanders excluded) —
   * feeds the assembly clock on the primary path. Omit to hide the clock.
   */
  libraryNames?: readonly string[];
}

/**
 * Shared methodology explainer for the assembly clock — one ⓘ per concept
 * (STYLE_GUIDE Info tooltips); also used by DeckTestHandPanel's clock line.
 */
export function assemblyClockTip(): JSX.Element {
  return (
    <>
      <span className="info-tip-lead">
        Across 1,000 simulated games: shuffle, draw an opening hand, then draw one card per turn
        until the win path is in hand — every piece of one combo, any one alt-win card, or a
        critical mass of a strategic plan. A drawn tutor counts as the missing piece it would fetch.
      </span>
      <span className="info-tip-lead">
        Draw spells, ramp, and mulligans aren&apos;t modeled, so real games usually run a little
        faster.
      </span>
    </>
  );
}

function WinConRow({
  wincon,
  primary,
  onTapCard,
}: {
  wincon: WinCondition;
  primary: boolean;
  onTapCard: (entries: CarouselEntry[], tappedName: string) => void;
}): JSX.Element {
  const entries = wincon.evidence.map((name) => ({ name, label: wincon.label }));

  return (
    <div className={`win-con-row${primary ? ' win-con-row--primary' : ''}`}>
      <div className="win-con-row-head">
        {primary && <Trophy className="win-con-trophy" width={13} height={13} aria-hidden />}
        <span className="win-con-label">{wincon.label}</span>
        {primary && <span className="win-con-tag">Primary</span>}
      </div>
      <p className="win-con-summary">{wincon.summary}</p>
      {wincon.evidence.length > 0 && (
        <ul className="win-con-evidence" aria-label={`Evidence for ${wincon.label}`}>
          {wincon.evidence.map((name) => (
            <li key={name} className="win-con-evidence-item">
              <button
                type="button"
                className="win-con-evidence-button"
                onClick={() => void onTapCard(entries, name)}
                aria-label={`Preview ${name}`}
              >
                <span className="card-name-chip-text" title={name}>
                  {name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Power-tab panel: how a commander deck wins (primary + secondary paths).
 * Mirrors EnginePanel structure — headline, per-path rows, no-clear-wincon
 * fallback message.
 */
export function WinConditionPanel({ analysis, libraryNames }: WinConditionPanelProps): JSX.Element {
  const carousel = useCardCarousel('Win conditions');

  // "Typically online by turn N" for the primary path. Null (→ hidden) when
  // the analysis predates the assembly field, the path has no discrete
  // assembly (generic combat), or the deck no longer holds the pieces.
  const clock = useMemo(() => {
    const assembly = analysis.primary?.assembly;
    if (!assembly?.length || !libraryNames?.length) return null;
    return simulateAssemblyClock(libraryNames, assembly, {
      iterations: 1000,
      wildcards: analysis.tutors,
    });
  }, [analysis, libraryNames]);

  if (analysis.noClearWinCondition) {
    return (
      <section className="win-con-panel" aria-label="Win condition analysis">
        <p className="win-con-headline win-con-headline--warn">
          <AlertTriangle className="win-con-warn-icon" width={14} height={14} aria-hidden />
          No clear win condition detected
        </p>
        <p className="win-con-empty">
          The deck doesn't have a dominant path to victory. Consider adding combo pieces, a damage
          plan, or building around a synergy strategy.
        </p>
      </section>
    );
  }

  return (
    <section className="win-con-panel" aria-label="Win condition analysis">
      {analysis.primary && (
        <WinConRow wincon={analysis.primary} primary onTapCard={carousel.open} />
      )}
      {clock && (
        <p className="win-con-clock">
          <Hourglass className="win-con-clock-icon" width={13} height={13} aria-hidden />
          <span>
            Typically online by turn <strong>{clock.typicalTurn}</strong>
            <span className="win-con-clock-sub">
              {' '}
              · 90% of games by turn {clock.p90Turn}, across 1,000 simulated draws
            </span>
          </span>
          <InfoTip
            label="the assembly clock"
            className="win-con-clock-tip"
            text={assemblyClockTip()}
          />
        </p>
      )}
      {analysis.secondary.length > 0 && (
        <>
          <h3 className="win-con-secondary-title">Backup paths</h3>
          {analysis.secondary.map((wc) => (
            <WinConRow key={wc.category} wincon={wc} primary={false} onTapCard={carousel.open} />
          ))}
        </>
      )}
      {carousel.preview}
    </section>
  );
}
