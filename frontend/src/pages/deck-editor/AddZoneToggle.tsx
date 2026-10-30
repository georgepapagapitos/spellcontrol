import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { Deck } from '../../store/decks';
import { ADD_ZONE_LABELS, type AddZone } from './add-zone';
import '@/styles/deck-builder-deck-extras.css';

/**
 * Which zone the add-cards sheet lands cards in. Unconditional (unlike the old
 * sideboard-only gate): Considering and In the box apply to every format, so
 * the toggle always offers them even when the format has no real sideboard.
 * In the box is where a box's extra physical cards go, such as a precon's
 * display commander: they claim a copy but are not played. Native radio
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
  const zones: AddZone[] = [
    'main',
    ...(formatConfig && formatConfig.sideboardSize > 0 ? (['side'] as const) : []),
    'considering',
    'box',
  ];
  return (
    <fieldset className="deck-editor-zone-toggle" aria-label="Add cards to">
      {zones.map((zone) => (
        <label key={zone} className="deck-editor-zone-toggle-option">
          <input
            className="overlay-input"
            type="radio"
            name="deck-editor-add-zone"
            value={zone}
            checked={addZone === zone}
            onChange={() => setAddZone(zone)}
          />
          <span className={`btn btn-sm${addZone === zone ? ' btn-primary' : ''}`}>
            {ADD_ZONE_LABELS[zone]}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
