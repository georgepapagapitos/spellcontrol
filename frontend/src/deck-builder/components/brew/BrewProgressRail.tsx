import type { JSX } from 'react';
import { Check } from 'lucide-react';
import './BrewProgressRail.css';
import { MeterBar } from '@/components/shared/MeterBar';
import type { BrewSlotDef } from '@/deck-builder/services/deckBuilder/brewSlots';

interface BrewProgressRailProps {
  slots: BrewSlotDef[];
  slotIndex: number;
  acceptedCounts: number[];
  totalAccepted: number;
  totalTarget: number;
  onSelectSlot: (index: number) => void;
}

/** The slot rail: which role we're filling, filled/target per slot, and the
 * running total toward the full library. Earlier slots are clickable to
 * jump back and reconsider; later ones are just previewed. */
export function BrewProgressRail({
  slots,
  slotIndex,
  acceptedCounts,
  totalAccepted,
  totalTarget,
  onSelectSlot,
}: BrewProgressRailProps): JSX.Element {
  return (
    <div className="brew-rail">
      <ol className="brew-rail-list">
        {slots.map((slot, i) => {
          const count = acceptedCounts[i] ?? 0;
          const done = i < slotIndex;
          const active = i === slotIndex;
          const filled = slot.target > 0 && count >= slot.target;
          return (
            <li key={slot.key}>
              <button
                type="button"
                className={`brew-rail-step${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}
                onClick={() => onSelectSlot(i)}
                disabled={i > slotIndex}
                aria-current={active ? 'step' : undefined}
              >
                <span className="brew-rail-step-icon" aria-hidden>
                  {done ? <Check width={12} height={12} /> : i + 1}
                </span>
                <span className="brew-rail-step-label">{slot.label}</span>
                <span className={`brew-rail-step-count${filled ? ' is-filled' : ''}`}>
                  {count}/{slot.target}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="brew-rail-total">
        <span>
          {totalAccepted} / {totalTarget} nonland cards
        </span>
        <MeterBar value={totalAccepted} max={Math.max(totalTarget, 1)} size="sm" />
      </div>
    </div>
  );
}
