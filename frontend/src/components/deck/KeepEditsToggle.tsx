import { keepEditsLabel, type DeckEdits } from '@/lib/deck/regenerate-edits';

interface KeepEditsToggleProps {
  edits: DeckEdits;
  checked: boolean;
  onChange: (keep: boolean) => void;
}

/**
 * The regenerate page's "carry my changes over" choice. Rendered only when
 * the source deck has edits; the counts in the label are what the player is
 * agreeing to carry, so the accessible name is the label alone.
 */
export function KeepEditsToggle({ edits, checked, onChange }: KeepEditsToggleProps) {
  return (
    <section className="deck-builder-section">
      <label className="collection-group-row">
        <input
          type="checkbox"
          className="collection-group-checkbox"
          checked={checked}
          aria-label={keepEditsLabel(edits)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="collection-group-text">
          <span className="collection-group-title">{keepEditsLabel(edits)}</span>
          <span className="collection-group-sub">
            {checked
              ? 'Cards you added are kept and cards you cut stay out.'
              : 'Rebuilds from the original settings.'}
          </span>
        </span>
      </label>
    </section>
  );
}
