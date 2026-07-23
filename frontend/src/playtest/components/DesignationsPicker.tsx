import { Check } from 'lucide-react';
import './DesignationsPicker.css';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import type { Designation } from '@/lib/playtest';

interface Props {
  monarch: boolean;
  initiative: boolean;
  citysBlessing: boolean;
  onSet(designation: Designation, held: boolean): void;
  onClose(): void;
}

interface Row {
  key: Designation;
  icon: string;
  inactiveLabel: string;
  activeLabel: string;
  description: string;
  /** City's Blessing only ever goes one way through this UI — the row locks
   *  (disabled) once achieved instead of offering a toggle back. */
  oneWay?: boolean;
}

const ROWS: Row[] = [
  {
    key: 'monarch',
    icon: '👑',
    inactiveLabel: 'Take Monarch',
    activeLabel: 'Remove Monarch',
    description: 'Draw an extra card at your end step. Passes to whoever deals you combat damage.',
  },
  {
    key: 'initiative',
    icon: '🧭',
    inactiveLabel: 'Take Initiative',
    activeLabel: 'Remove Initiative',
    description: 'Venture into the Undercity when you deal combat damage. Passes the same way.',
  },
  {
    key: 'citysBlessing',
    icon: '🏙️',
    inactiveLabel: "Achieve City's Blessing",
    activeLabel: "City's Blessing achieved",
    description: 'Permanent once you control 10+ permanents. Never lost for the rest of the game.',
    oneWay: true,
  },
];

/**
 * Table designations (E-123-ish playtest badges) — Monarch, Initiative,
 * City's Blessing. A row per designation; monarch/initiative are reversible
 * toggles (the row itself is the switch), City's Blessing locks once achieved
 * — matching the real rule that it's never lost mid-game. Doesn't auto-close
 * on a toggle (unlike ResistancePicker's exclusive pick) since flipping more
 * than one designation in a visit is the common case.
 */
export function DesignationsPicker({ monarch, initiative, citysBlessing, onSet, onClose }: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  useLockBodyScroll();
  useEscapeKey(beginClose);

  const held: Record<Designation, boolean> = { monarch, initiative, citysBlessing };

  return (
    <div className="card-picker-root" role="presentation" onClick={() => beginClose()}>
      <div className="card-picker-backdrop" />
      <div
        className={`card-picker-sheet playtest-designations-picker${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Designations"
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">Designations</h2>
        </div>
        <div className="playtest-designations-picker__list">
          {ROWS.map((row) => {
            const active = held[row.key];
            const locked = row.oneWay && active;
            return (
              <button
                key={row.key}
                type="button"
                role={row.oneWay ? undefined : 'switch'}
                aria-checked={row.oneWay ? undefined : active}
                disabled={locked}
                className={`playtest-designations-picker__row${active ? ' is-active' : ''}`}
                onClick={() => onSet(row.key, row.oneWay ? true : !active)}
              >
                <span className="playtest-designations-picker__row-icon" aria-hidden>
                  {row.icon}
                </span>
                <span className="playtest-designations-picker__row-text">
                  <span className="playtest-designations-picker__row-label">
                    {active ? row.activeLabel : row.inactiveLabel}
                  </span>
                  <span className="playtest-designations-picker__row-desc">{row.description}</span>
                </span>
                {active && (
                  <Check
                    className="playtest-designations-picker__row-check"
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
