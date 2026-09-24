import { useState } from 'react';

interface Props {
  attackers: number;
  power: number;
  onTake(damage: number): void;
}

/**
 * The damage-total banner (design point 4): the horde's total, a numeric
 * field prefilled with it, and a primary "Take N" — or "Skip" once the
 * field reads 0, since nothing got through.
 */
export function HordeAttackBanner({ attackers, power, onTake }: Props) {
  const [value, setValue] = useState(power);

  return (
    <div className="horde-attack-banner" role="status">
      <p>
        The horde attacks: {attackers} creature{attackers === 1 ? '' : 's'}, {power} power. How much
        got through?
      </p>
      <div className="horde-attack-banner-input">
        <label htmlFor="horde-attack-amount">Damage</label>
        <input
          id="horde-attack-amount"
          type="number"
          min={0}
          max={power}
          value={value}
          onChange={(e) => setValue(Math.max(0, Math.min(power, Number(e.target.value) || 0)))}
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
