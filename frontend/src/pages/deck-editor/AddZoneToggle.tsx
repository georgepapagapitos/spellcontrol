import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { Deck } from '../../store/decks';
import '@/styles/deck-builder-deck-extras.css';

export type AddZone = 'main' | 'side' | 'considering';

/**
 * Which zone the add-cards sheet lands cards in. Unconditional (unlike the old
 * sideboard-only gate): Considering applies to every format, so the toggle
 * always offers it even when the format has no real sideboard. Native radio
 * semantics (STYLE_GUIDE "exclusive-value picker" ruling: a hidden radio input
 * stretched over a styled label, mirroring .settings-currency-toggle) rather
 * than aria-pressed buttons, so exclusivity and arrow-key group nav come from
 * the browser.
 */
export function AddZoneToggle({
  addZone,
  setAddZone,
  formatConfig,
}: {
  addZone: AddZone;
  setAddZone: (zone: AddZone) => void;
  formatConfig: (typeof DECK_FORMAT_CONFIGS)[Deck['format']] | null;
}) {
  return (
    <fieldset className="deck-editor-zone-toggle" aria-label="Add cards to">
      <label className="deck-editor-zone-toggle-option">
        <input
          type="radio"
          name="deck-editor-add-zone"
          value="main"
          checked={addZone === 'main'}
          onChange={() => setAddZone('main')}
        />
        <span className={`btn btn-sm${addZone === 'main' ? ' btn-primary' : ''}`}>Mainboard</span>
      </label>
      {formatConfig && formatConfig.sideboardSize > 0 && (
        <label className="deck-editor-zone-toggle-option">
          <input
            type="radio"
            name="deck-editor-add-zone"
            value="side"
            checked={addZone === 'side'}
            onChange={() => setAddZone('side')}
          />
          <span className={`btn btn-sm${addZone === 'side' ? ' btn-primary' : ''}`}>Sideboard</span>
        </label>
      )}
      <label className="deck-editor-zone-toggle-option">
        <input
          type="radio"
          name="deck-editor-add-zone"
          value="considering"
          checked={addZone === 'considering'}
          onChange={() => setAddZone('considering')}
        />
        <span className={`btn btn-sm${addZone === 'considering' ? ' btn-primary' : ''}`}>
          Considering
        </span>
      </label>
    </fieldset>
  );
}
