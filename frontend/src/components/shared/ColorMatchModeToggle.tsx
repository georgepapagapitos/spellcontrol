import './ColorMatchModeToggle.css';
import type { ColorMatchMode } from '../../lib/colors';

export interface ColorMatchModeToggleProps {
  mode: ColorMatchMode;
  onChange: (next: ColorMatchMode) => void;
  className?: string;
}

/**
 * AND / OR mode chip for a color pip row — the same joiner-pill language as
 * ChipExpressionBuilder's between-chip toggle, so flipping combine semantics
 * looks identical everywhere it appears. OR (default) keeps the historical
 * "shows any selected color" behavior; AND narrows to cards showing every
 * selected color (R + W = Boros cards, not all red plus all white).
 *
 * The visible hint spells out the current semantics because — unlike the
 * expression builder — this pill doesn't sit between two value chips that
 * make the operator self-explanatory.
 */
export function ColorMatchModeToggle({ mode, onChange, className }: ColorMatchModeToggleProps) {
  const all = mode === 'all';
  return (
    <span className={`color-mode-toggle${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className={`chip-joiner ${all ? 'and' : 'or'}`}
        onClick={() => onChange(all ? 'any' : 'all')}
        title={
          all
            ? 'AND — cards must show every selected color; click for OR'
            : 'OR — cards showing any selected color; click for AND'
        }
        aria-label={
          all
            ? 'Color match mode: all selected colors (AND); click to switch to any (OR)'
            : 'Color match mode: any selected color (OR); click to switch to all (AND)'
        }
      >
        {all ? 'AND' : 'OR'}
      </button>
      <span className="color-mode-toggle-hint" aria-hidden>
        {all ? 'all selected colors' : 'any selected color'}
      </span>
    </span>
  );
}
