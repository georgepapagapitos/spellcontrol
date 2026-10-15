import { useState } from 'react';
import { Chip } from '@/components/shared/Chip';
import './filter-kit.css';

/** The value: an open or closed range. Empty (`{}`) is no filter. */
export interface PresetRangeValue {
  min?: number;
  max?: number;
}

export interface RangePreset extends PresetRangeValue {
  /** "Under $1", "$1–$5", "$20+". */
  label: string;
}

export interface PresetRangeProps {
  value: PresetRangeValue;
  onChange: (next: PresetRangeValue) => void;
  presets: RangePreset[];
  /** Names the chip group ("Filter by price"). */
  ariaLabel: string;
  /** What the number is, for the Custom… inputs' names ("Price", "EDHREC rank"). */
  valueLabel: string;
  /** Shown before each custom input ("$"). */
  prefix?: string;
  /** The inputs' step; 0.01 for money. */
  step?: number;
}

const num = (raw: string): number | undefined => {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

const same = (a: PresetRangeValue, b: PresetRangeValue) => a.min === b.min && a.max === b.max;
const isEmpty = (v: PresetRangeValue) => v.min === undefined && v.max === undefined;

/**
 * Preset ranges for an open-ended number (price, EDHREC rank), then Custom…
 * for min and max inputs. A preset is on when the value equals it; touching
 * the one that is on clears it. Custom… is on whenever the value matches no
 * preset, or the person opened it.
 */
export function PresetRange({
  value,
  onChange,
  presets,
  ariaLabel,
  valueLabel,
  prefix,
  step = 1,
}: PresetRangeProps) {
  const [opened, setOpened] = useState(false);
  const matched = presets.some((p) => same(p, value));
  const custom = opened || (!isEmpty(value) && !matched);
  return (
    <div className="filter-kit-strip">
      <div className="filter-kit-chips" role="group" aria-label={ariaLabel}>
        {presets.map((p) => {
          const on = same(p, value);
          return (
            <Chip
              key={p.label}
              className="filter-chip filter-kit-chip"
              pressed={on}
              onClick={() => {
                setOpened(false);
                onChange(on ? {} : { min: p.min, max: p.max });
              }}
            >
              {p.label}
            </Chip>
          );
        })}
        <Chip
          className="filter-chip filter-kit-chip"
          pressed={custom}
          onClick={() => {
            if (custom) {
              setOpened(false);
              onChange({});
            } else {
              setOpened(true);
            }
          }}
        >
          Custom…
        </Chip>
      </div>
      {custom && (
        <div className="filter-kit-compare">
          {(['min', 'max'] as const).map((k) => (
            <label key={k} className="filter-kit-range-field">
              <span className="filter-kit-compare-label">{k === 'min' ? 'Min' : 'Max'}</span>
              {prefix && <span aria-hidden="true">{prefix}</span>}
              <input
                className="filter-kit-number"
                type="number"
                inputMode="decimal"
                min={0}
                step={step}
                aria-label={`${valueLabel}, ${k === 'min' ? 'minimum' : 'maximum'}`}
                value={value[k] ?? ''}
                onChange={(e) => onChange({ ...value, [k]: num(e.target.value) })}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
