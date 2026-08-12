import { Check } from 'lucide-react';
import './TakebackModePicker.css';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { TAKEBACK_MODES, TAKEBACK_MODE_DESCRIPTION, TAKEBACK_MODE_LABEL } from '../lib/takeback';
import type { TakebackMode } from '../lib/takeback';

interface Props {
  mode: TakebackMode;
  onSelect(mode: TakebackMode): void;
  onClose(): void;
}

/**
 * Table takeback rule picker — same shape as ResistancePicker (a radiogroup
 * of options, each with a plain-language one-liner). Note the deliberate
 * absence of any escape hatch for `locked`: this sheet only ever offers
 * Ask/Free/Off, never a "skip the ask for hidden info" option, because
 * `resolveTakebackPlan` (lib/takeback.ts) blocks `locked` before `mode` is
 * even consulted — there is no mode value that could reach it.
 */
export function TakebackModePicker({ mode, onSelect, onClose }: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  useLockBodyScroll();
  useEscapeKey(beginClose);

  function select(next: TakebackMode) {
    onSelect(next);
    beginClose();
  }

  return (
    <div className="card-picker-root" role="presentation" onClick={() => beginClose()}>
      <div className="card-picker-backdrop" />
      <div
        className={`card-picker-sheet playtest-takeback-picker${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Takeback table rule"
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">Takeback rule</h2>
          <p className="playtest-takeback-picker__intro">
            Steps nobody but you saw always take back free. This decides what happens to the ones
            the table already saw — hidden information is never returned, no matter what you pick
            here.
          </p>
        </div>
        <fieldset className="playtest-takeback-picker__list" aria-label="Takeback rule">
          {TAKEBACK_MODES.map((m) => {
            const active = m === mode;
            return (
              <label
                key={m}
                className={`playtest-takeback-picker__row${active ? ' is-active' : ''}`}
              >
                <input
                  type="radio"
                  name="takeback-mode"
                  checked={active}
                  onChange={() => select(m)}
                />
                <span className="playtest-takeback-picker__row-text">
                  <span className="playtest-takeback-picker__row-label">
                    {TAKEBACK_MODE_LABEL[m]}
                  </span>
                  <span className="playtest-takeback-picker__row-desc">
                    {TAKEBACK_MODE_DESCRIPTION[m]}
                  </span>
                </span>
                {active && (
                  <Check
                    className="playtest-takeback-picker__row-check"
                    aria-hidden
                    width={18}
                    height={18}
                    strokeWidth={2.5}
                  />
                )}
              </label>
            );
          })}
        </fieldset>
        <div className="card-picker-footer">
          <button type="button" className="btn" onClick={() => beginClose()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
