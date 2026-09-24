import { useId, type CSSProperties } from 'react';
import { Modal } from '@/components/Modal';
import { FELTS, type SkinOption } from '../lib/table-skin';

/** One preference that owns its own picker: this row states where it stands
 *  and opens that picker. Keeps each existing picker untouched while giving
 *  them a single home. */
export interface SettingLink {
  label: string;
  value: string;
  onOpen(): void;
}

/** An on/off preference that lives here in full: one row, a switch. */
export interface SettingToggle {
  label: string;
  /** One line under the label saying what On does. */
  hint: string;
  on: boolean;
  onChange(on: boolean): void;
}

/** How the table looks, both halves of it (E347). Per-device, like card size
 *  — opponents see the board you publish, never your CSS. */
export interface TableSkin {
  felt: string;
  onFelt(id: string): void;
}

/**
 * A row of swatches. Native radios inside a `fieldset`, never `role="radio"`
 * buttons: exclusivity, arrow-key navigation and a single group tab stop come
 * free, and the hand-rolled version of this is what `no-aria-only-radiogroups`
 * exists to stop.
 */
function SwatchRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly SkinOption[];
  value: string;
  onChange(id: string): void;
}) {
  // Two swatch rows in one sheet share a DOM; without distinct names they
  // would be one radio group and deselect each other.
  const groupName = useId();
  return (
    <div className="playtest-settings__row playtest-settings__row--skin">
      <span className="shortcuts-overlay-desc">{label}</span>
      <fieldset className="playtest-skin" aria-label={label}>
        {options.map((o) => (
          <label key={o.id} className="playtest-skin__option" title={o.label}>
            <input
              type="radio"
              name={groupName}
              checked={value === o.id}
              onChange={() => onChange(o.id)}
              aria-label={o.label}
            />
            <span
              className={`playtest-skin__swatch${value === o.id ? ' is-selected' : ''}`}
              style={{ background: o.swatch }}
            />
          </label>
        ))}
      </fieldset>
    </div>
  );
}

interface Props {
  /** Multiplier on the tier's card density; 1 is the default. Absent on the
   *  narrow tier, where cards are sized for a thumb and there is nothing to
   *  set. */
  zoom?: { value: number; min: number; max: number; step: number; onZoom(zoom: number): void };
  /** Felt colour. Absent (tests, previews) hides the row. */
  skin?: TableSkin;
  /** Snap to grid, and the turn alert when seated online. */
  toggles?: SettingToggle[];
  /** Takeback rule and Resistance, in that order. */
  links: SettingLink[];
  onClose(): void;
}

/**
 * The table's preferences, in one place (EDHPlay's "Preferences"). The game
 * menu used to list each of these as its own row and had grown to sixteen;
 * the menu is now actions, and anything you set-and-forget lives here.
 *
 * Card size is the one setting rendered in full, because a slider you drag
 * while watching the table cannot be a separate sheet. The rest state their
 * current value and open the picker that already owns them. Game state you
 * change mid-game (Monarch, Initiative) is not a preference and lives in the
 * game menu instead.
 */
export function TableSettingsSheet({ zoom, skin, toggles = [], links, onClose }: Props) {
  const toggleId = useId();
  const pct = zoom ? Math.round(zoom.value * 100) : 0;
  const progress = zoom
    ? `${Math.round(((zoom.value - zoom.min) / (zoom.max - zoom.min)) * 100)}%`
    : '0%';
  return (
    <Modal onClose={onClose} labelledBy="playtest-settings-title" className="shortcuts-overlay">
      <header className="shortcuts-overlay-head">
        <h2 id="playtest-settings-title" className="shortcuts-overlay-title">
          Table settings
        </h2>
        <button
          type="button"
          className="shortcuts-overlay-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </header>
      <div className="shortcuts-overlay-body">
        {zoom && (
          <>
            <div className="playtest-settings__row">
              <label htmlFor="playtest-card-size" className="shortcuts-overlay-desc">
                Card size
              </label>
              <input
                id="playtest-card-size"
                type="range"
                className="playtest-settings__range"
                min={zoom.min}
                max={zoom.max}
                step={zoom.step}
                value={zoom.value}
                aria-valuetext={`${pct}%`}
                style={{ '--range-progress': progress } as CSSProperties}
                onChange={(e) => zoom.onZoom(Number(e.target.value))}
              />
              <output htmlFor="playtest-card-size" className="playtest-settings__value">
                {pct}%
              </output>
            </div>
            <p className="playtest-settings__hint">
              Your hand, the battlefield and the zone piles all follow it. The = and − keys step it
              too.
            </p>
          </>
        )}
        {skin && (
          <>
            <SwatchRow label="Felt" options={FELTS} value={skin.felt} onChange={skin.onFelt} />
            <p className="playtest-settings__hint">
              Your table only. Everyone else sees their own felt.
            </p>
          </>
        )}
        {toggles.length > 0 && (
          <ul className="playtest-settings__links" role="list">
            {toggles.map((t, i) => (
              <li key={t.label}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={t.on}
                  aria-labelledby={`${toggleId}-${i}`}
                  aria-describedby={`${toggleId}-${i}-hint`}
                  className={`playtest-settings__link playtest-settings__toggle${t.on ? ' is-on' : ''}`}
                  onClick={() => t.onChange(!t.on)}
                >
                  <span className="playtest-settings__toggle-text">
                    <span id={`${toggleId}-${i}`} className="playtest-settings__link-label">
                      {t.label}
                    </span>
                    <span id={`${toggleId}-${i}-hint`} className="playtest-settings__toggle-hint">
                      {t.hint}
                    </span>
                  </span>
                  <span className="playtest-settings__link-value" aria-hidden="true">
                    {t.on ? 'On' : 'Off'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <ul className="playtest-settings__links" role="list">
          {links.map((l) => (
            <li key={l.label}>
              <button type="button" className="playtest-settings__link" onClick={l.onOpen}>
                <span className="playtest-settings__link-label">{l.label}</span>
                <span className="playtest-settings__link-value">{l.value}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {zoom && (
        <footer className="playtest-shortcuts-foot">
          <button
            type="button"
            className="btn"
            disabled={zoom.value === 1}
            onClick={() => zoom.onZoom(1)}
          >
            Reset card size
          </button>
        </footer>
      )}
    </Modal>
  );
}
