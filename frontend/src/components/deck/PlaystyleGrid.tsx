import { PLAYSTYLES, type Playstyle } from '../../lib/commander-playstyle-index';

interface Props {
  onSelect: (style: Playstyle) => void;
  /** Highlights the matching card (e.g. the last-picked style). */
  activeId?: string | null;
}

/**
 * Descriptive playstyle picker — a grid of label + blurb cards. Shared by the
 * guided build flow (PlaystylePicker) and the new-deck "By playstyle" tab
 * (CommanderSearch) so both surfaces stay in lockstep. Purely presentational;
 * the parent owns the selected-state swap (collapse to a back-bar + the
 * commander list once a style is chosen). Styles live in deck-builder-guided.css
 * (`.playstyle-grid` / `.playstyle-card`).
 */
export function PlaystyleGrid({ onSelect, activeId = null }: Props) {
  return (
    <div className="playstyle-grid" role="group" aria-label="Choose a playstyle">
      {PLAYSTYLES.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`playstyle-card${activeId === s.id ? ' active' : ''}`}
          aria-pressed={activeId === s.id}
          onClick={() => onSelect(s)}
        >
          <span className="playstyle-card-label">{s.label}</span>
          <span className="playstyle-card-blurb">{s.blurb}</span>
        </button>
      ))}
    </div>
  );
}
