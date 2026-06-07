import type { JSX } from 'react';
import './WinConditionPanel.css';
import { AlertTriangle, Trophy } from 'lucide-react';
import type {
  WinConditionAnalysis,
  WinCondition,
} from '@/deck-builder/services/winConditions/types';

export interface WinConditionPanelProps {
  analysis: WinConditionAnalysis;
}

function WinConRow({ wincon, primary }: { wincon: WinCondition; primary: boolean }): JSX.Element {
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
              {name}
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
export function WinConditionPanel({ analysis }: WinConditionPanelProps): JSX.Element {
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
      {analysis.primary && <WinConRow wincon={analysis.primary} primary />}
      {analysis.secondary.length > 0 && (
        <>
          <h3 className="win-con-secondary-title">Backup paths</h3>
          {analysis.secondary.map((wc) => (
            <WinConRow key={wc.category} wincon={wc} primary={false} />
          ))}
        </>
      )}
    </section>
  );
}
