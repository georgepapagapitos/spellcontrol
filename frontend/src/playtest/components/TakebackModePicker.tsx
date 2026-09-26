import { Check } from 'lucide-react';
import './TakebackModePicker.css';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { TAKEBACK_MODES, TAKEBACK_MODE_DESCRIPTION, TAKEBACK_MODE_LABEL } from '../lib/takeback';
import type { TakebackMode } from '../lib/takeback';
import { Button } from '@/components/shared/Button';

interface Props {
  mode: TakebackMode;
  onSelect(mode: TakebackMode): void;
  onClose(): void;
  /** Solo play has nobody to ask — `resolveTakebackPlan` already applies an
   *  'ask' verdict immediately when `!online` (see lib/takeback.ts's "nobody
   *  to ask" branch); B6-15 asks that the picker say so instead of promising
   *  a table vote that never happens locally. */
  online: boolean;
}

/**
 * Table takeback rule picker — same shape as ResistancePicker (a radiogroup
 * of options, each with a plain-language one-liner). Note the deliberate
 * absence of any escape hatch for `locked`: this sheet only ever offers
 * Ask/Free/Off, never a "skip the ask for hidden info" option, because
 * `resolveTakebackPlan` (lib/takeback.ts) blocks `locked` before `mode` is
 * even consulted — there is no mode value that could reach it.
 */
export function TakebackModePicker({ mode, onSelect, onClose, online }: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  useLockBodyScroll();
  useEscapeKey(beginClose);

  function select(next: TakebackMode) {
    onSelect(next);
    beginClose();
  }

  function description(m: TakebackMode): string {
    if (m === 'ask' && !online) {
      return 'Solo play has nobody to ask, so this takes back immediately, like Free.';
    }
    return TAKEBACK_MODE_DESCRIPTION[m];
  }

  return (
    <div className="card-picker-root">
      {/* The backdrop fully covers the root (both `inset: 0`), so it — not
          root — is what a "click outside the sheet" actually lands on. */}
      <div className="card-picker-backdrop" role="presentation" onClick={() => beginClose()} />
      <div
        className={`card-picker-sheet playtest-takeback-picker${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Your takeback rule"
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">Your takeback rule</h2>
          <p className="playtest-takeback-picker__intro">
            Steps nobody but you saw always take back free. This only covers steps the table already
            saw, and it is your rule alone: every player sets their own. Hidden information never
            returns.
          </p>
        </div>
        <fieldset className="playtest-takeback-picker__list" aria-label="Your takeback rule">
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
                  <span className="playtest-takeback-picker__row-desc">{description(m)}</span>
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
          <Button onClick={() => beginClose()}>Close</Button>
        </div>
      </div>
    </div>
  );
}
