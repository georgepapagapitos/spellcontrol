import type { CSSProperties } from 'react';
import { Modal } from '@/components/Modal';

interface Props {
  /** Multiplier on the tier's card density; 1 is the default. */
  zoom: number;
  min: number;
  max: number;
  step: number;
  onZoom(zoom: number): void;
  onClose(): void;
}

/**
 * The table's own preferences (EDHPlay's "Game preferences"): today that is
 * the card size, as a slider that applies as it moves. The same multiplier
 * the = and − keys step, so the two never disagree.
 */
export function TableSettingsSheet({ zoom, min, max, step, onZoom, onClose }: Props) {
  const pct = Math.round(zoom * 100);
  const progress = `${Math.round(((zoom - min) / (max - min)) * 100)}%`;
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
        <div className="playtest-settings__row">
          <label htmlFor="playtest-card-size" className="shortcuts-overlay-desc">
            Card size
          </label>
          <input
            id="playtest-card-size"
            type="range"
            className="playtest-settings__range"
            min={min}
            max={max}
            step={step}
            value={zoom}
            aria-valuetext={`${pct}%`}
            style={{ '--range-progress': progress } as CSSProperties}
            onChange={(e) => onZoom(Number(e.target.value))}
          />
          <output htmlFor="playtest-card-size" className="playtest-settings__value">
            {pct}%
          </output>
        </div>
        <p className="playtest-settings__hint">
          Your hand, the battlefield and the zone piles all follow it. The = and − keys step it too.
        </p>
      </div>
      <footer className="playtest-shortcuts-foot">
        <button type="button" className="btn" disabled={zoom === 1} onClick={() => onZoom(1)}>
          Reset to default
        </button>
      </footer>
    </Modal>
  );
}
