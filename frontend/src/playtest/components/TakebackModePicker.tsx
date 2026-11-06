import { useRef } from 'react';
import { Check } from 'lucide-react';
import './TakebackModePicker.css';
import { Sheet, type SheetHandle } from '@/components/overlays/Sheet';
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
  const sheetRef = useRef<SheetHandle>(null);
  function select(next: TakebackMode) {
    onSelect(next);
    sheetRef.current?.close();
  }

  function description(m: TakebackMode): string {
    if (m === 'ask' && !online) {
      return 'Solo play has nobody to ask, so this acts like Free.';
    }
    return TAKEBACK_MODE_DESCRIPTION[m];
  }

  return (
    <Sheet
      ref={sheetRef}
      inPlace
      onClose={onClose}
      className="playtest-takeback-picker"
      title="Your takeback rule"
      description={
        <>
          Steps nobody else saw always take back free. This rule covers the rest, and each player
          sets their own.
        </>
      }
      footer={(close) => (
        <>
          <Button onClick={() => close()}>Close</Button>
        </>
      )}
    >
      <fieldset className="playtest-takeback-picker__list" aria-label="Your takeback rule">
        {TAKEBACK_MODES.map((m) => {
          const active = m === mode;
          return (
            <label key={m} className={`playtest-takeback-picker__row${active ? ' is-active' : ''}`}>
              <input
                className="overlay-input"
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
                  strokeWidth={2}
                />
              )}
            </label>
          );
        })}
      </fieldset>
    </Sheet>
  );
}
