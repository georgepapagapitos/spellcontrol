import type { CSSProperties } from 'react';
import { Modal } from '@/components/Modal';

/** One preference that owns its own picker: this row states where it stands
 *  and opens that picker. Keeps each existing picker untouched while giving
 *  them a single home. */
export interface SettingLink {
  label: string;
  value: string;
  onOpen(): void;
}

interface Props {
  /** Multiplier on the tier's card density; 1 is the default. Absent on the
   *  narrow tier, where cards are sized for a thumb and there is nothing to
   *  set. */
  zoom?: { value: number; min: number; max: number; step: number; onZoom(zoom: number): void };
  /** Takeback rule, Resistance, Designations — in that order. */
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
 * current value and open the picker that already owns them.
 */
export function TableSettingsSheet({ zoom, links, onClose }: Props) {
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
