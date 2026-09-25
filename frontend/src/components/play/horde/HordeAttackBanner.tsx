import { useState } from 'react';
import { VARIABLE_POWER_CEILING, variablePowerCount, type AttackerGroup } from '@/lib/horde';

interface Props {
  attackers: number;
  power: number;
  groups: readonly AttackerGroup[];
  onTake(damage: number): void;
}

/**
 * The damage-total banner (design point 4): the horde's total, a numeric
 * field prefilled with it, and a primary "Take N" — or "Skip" once the
 * field reads 0, since nothing got through. A `*`/`*` attacker (Soulless
 * One) prints no real number — `power` counts it as 0 — so the field's max
 * only clamps to `power` when every attacker's power IS a number; otherwise
 * it accepts anything up to a sane ceiling (#2178).
 */
export function HordeAttackBanner({ attackers, power, groups, onTake }: Props) {
  const [value, setValue] = useState(power);
  const variable = variablePowerCount(groups);
  const max = variable > 0 ? VARIABLE_POWER_CEILING : power;

  return (
    <div className="horde-attack-banner" role="status">
      <p>
        The horde attacks: {attackers} creature{attackers === 1 ? '' : 's'}, {power} power
        {variable > 0 ? `, plus ${variable} with variable power` : ''}. How much got through?
      </p>
      <div className="horde-attack-banner-input">
        <label htmlFor="horde-attack-amount">Damage</label>
        <input
          id="horde-attack-amount"
          // Not `type="number"`: Chrome/Edge's native spin buttons render
          // INSIDE the content box and eat into the visible text area, so
          // even a correctly-sized `content-box` width still clipped a
          // two-digit value ("14" as "1") — the digit-only text field the
          // damage sheet already uses for the same reason.
          type="text"
          inputMode="numeric"
          value={value}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw !== '' && !/^\d+$/.test(raw)) return;
            setValue(raw === '' ? 0 : Math.max(0, Math.min(max, Number(raw))));
          }}
        />
      </div>
      <div className="horde-attack-banner-actions">
        {value === 0 ? (
          <button type="button" className="btn btn-primary" onClick={() => onTake(0)}>
            Skip
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => onTake(value)}>
            Take {value}
          </button>
        )}
      </div>
    </div>
  );
}
