import { useState } from 'react';
import { Check } from 'lucide-react';
import './ResistancePicker.css';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import {
  loadLastResistanceLevel,
  RESISTANCE_LEVELS,
  RESISTANCE_LEVEL_DESCRIPTION,
  RESISTANCE_LEVEL_LABEL,
  type ResistanceLevel,
} from '../lib/resistance';

interface Props {
  level: ResistanceLevel;
  onSelect(level: ResistanceLevel): void;
  onClose(): void;
}

/**
 * Difficulty picker for "Resistance" (E142) — replaces the old on/off toggle.
 * A radiogroup of the four levels, each with a one-line plain-language
 * description; picking one applies it immediately and closes. When currently
 * off, the device's last-used level (localStorage) gets initial keyboard
 * focus so re-enabling defaults to it — one Enter press away.
 */
export function ResistancePicker({ level, onSelect, onClose }: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  useLockBodyScroll();
  useEscapeKey(beginClose);
  const [lastUsed] = useState(loadLastResistanceLevel);

  function select(next: ResistanceLevel) {
    onSelect(next);
    beginClose();
  }

  return (
    <div className="card-picker-root" role="presentation" onClick={() => beginClose()}>
      <div className="card-picker-backdrop" />
      <div
        className={`card-picker-sheet playtest-resistance-picker${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Resistance difficulty"
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">Resistance</h2>
          <p className="playtest-resistance-picker__intro">
            A simulated opponent that occasionally counters, removes, or wipes your plays.
          </p>
        </div>
        <div className="playtest-resistance-picker__list" role="radiogroup" aria-label="Difficulty">
          {RESISTANCE_LEVELS.map((l) => {
            const active = l === level;
            const isLastUsed = level === 'off' && l === lastUsed;
            return (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={active}
                autoFocus={isLastUsed}
                className={`playtest-resistance-picker__row${active ? ' is-active' : ''}`}
                onClick={() => select(l)}
              >
                <span className="playtest-resistance-picker__row-text">
                  <span className="playtest-resistance-picker__row-label">
                    {RESISTANCE_LEVEL_LABEL[l]}
                    {isLastUsed && (
                      <span className="playtest-resistance-picker__row-tag">Last used</span>
                    )}
                  </span>
                  <span className="playtest-resistance-picker__row-desc">
                    {RESISTANCE_LEVEL_DESCRIPTION[l]}
                  </span>
                </span>
                {active && (
                  <Check
                    className="playtest-resistance-picker__row-check"
                    aria-hidden
                    width={18}
                    height={18}
                    strokeWidth={2.5}
                  />
                )}
              </button>
            );
          })}
        </div>
        <div className="card-picker-footer">
          <button type="button" className="btn" onClick={() => beginClose()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
