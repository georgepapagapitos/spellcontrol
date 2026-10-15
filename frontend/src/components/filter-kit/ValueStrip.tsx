import { useState } from 'react';
import { Chip } from '@/components/shared/Chip';
import { SegmentedControl } from '@/components/shared/form';
import {
  EMPTY_VALUE_STRIP,
  isValueStripRange,
  type ValueStripChips,
  type ValueStripRange,
  type ValueStripValue,
} from './value-strip';
import './filter-kit.css';

type Op = 'exactly' | 'atMost' | 'atLeast' | 'between';

const OPS: Array<{ value: Op; label: string }> = [
  { value: 'exactly', label: 'Exactly' },
  { value: 'atMost', label: 'At most' },
  { value: 'atLeast', label: 'At least' },
  { value: 'between', label: 'Between' },
];

function opOf(r: ValueStripRange): Op {
  if (r.min !== undefined && r.max !== undefined) return r.min === r.max ? 'exactly' : 'between';
  if (r.max !== undefined) return 'atMost';
  return 'atLeast';
}

const num = (raw: string): number | undefined => {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

export interface ValueStripProps {
  value: ValueStripValue;
  onChange: (next: ValueStripValue) => void;
  /** Names the chip group ("Filter by mana value"). */
  ariaLabel: string;
  /** The word the comparator's inputs are named for ("Mana value"). */
  valueLabel: string;
  /**
   * The open top chip's value: chips run 0 to `top - 1`, then `top+`. Its
   * second row runs `top` to `top + 5`, then `top + 6` with a plus. Defaults to
   * 7 for mana value; power and toughness pass their own.
   */
  top?: number;
}

/**
 * Chips for a small whole number (mana value, power, toughness). Values toggle
 * independently; the top chip (7+) is open-ended and reveals a second row to
 * narrow it, where picking none keeps all of 7 and up. "Custom…" swaps the
 * chips for a comparator for what chips can't say (at least 10, between 4 and
 * 9). Touching a chip again leaves Custom….
 */
export function ValueStrip({ value, onChange, ariaLabel, valueLabel, top = 7 }: ValueStripProps) {
  // The comparator the person picked; a half-filled "between" reads as "at least" otherwise.
  const [picked, setPicked] = useState<Op | null>(null);
  const range = isValueStripRange(value);
  const chips: ValueStripChips = range ? EMPTY_VALUE_STRIP : value;
  const topEnd = top + 6;

  const lows = Array.from({ length: top }, (_, i) => i);
  const highs = Array.from({ length: topEnd - top }, (_, i) => top + i);

  const open = chips.atLeast !== undefined || chips.values.some((v) => v >= top);
  const lowValues = chips.values.filter((v) => v < top);
  const highValues = chips.values.filter((v) => v >= top);

  const emit = (low: number[], high: number[], atLeast: number | undefined) =>
    onChange({
      values: [...low, ...high].sort((a, b) => a - b),
      ...(atLeast !== undefined ? { atLeast } : {}),
    });
  /** The open row with nothing narrowed in it means "all of top and up". */
  const emitHigh = (high: number[], atLeast: number | undefined) =>
    emit(lowValues, high, high.length === 0 && atLeast === undefined ? top : atLeast);

  const toggle = (list: number[], n: number) =>
    list.includes(n) ? list.filter((v) => v !== n) : [...list, n];

  const onTop = () => {
    if (open) emit(lowValues, [], undefined);
    else emit(lowValues, [], top);
  };
  const onHigh = (n: number) => {
    // Narrowing replaces the unnarrowed "top and up", so the first pick drops it.
    const keep = chips.atLeast !== undefined && chips.atLeast > top ? chips.atLeast : undefined;
    emitHigh(toggle(highValues, n), keep);
  };
  const endOn = chips.atLeast === topEnd;
  const onEnd = () => emitHigh(highValues, chips.atLeast === topEnd ? undefined : topEnd);

  const op: Op = range ? (picked ?? opOf(value)) : 'atLeast';
  const first = range ? (op === 'atMost' ? value.max : value.min) : undefined;
  const setOp = (next: Op) => {
    setPicked(next);
    const a = first;
    const b = range ? value.max : undefined;
    if (next === 'exactly') onChange(a === undefined ? {} : { min: a, max: a });
    else if (next === 'atMost') onChange(a === undefined ? {} : { max: a });
    else if (next === 'atLeast') onChange(a === undefined ? {} : { min: a });
    else onChange({ min: a, max: b !== undefined && b !== a ? b : undefined });
  };
  const setFirst = (n: number | undefined) => {
    if (op === 'exactly') onChange(n === undefined ? {} : { min: n, max: n });
    else if (op === 'atMost') onChange(n === undefined ? {} : { max: n });
    else if (op === 'atLeast') onChange(n === undefined ? {} : { min: n });
    else onChange({ min: n, max: range ? value.max : undefined });
  };

  return (
    <div className="filter-kit-strip">
      <div className="filter-kit-chips" role="group" aria-label={ariaLabel}>
        {lows.map((n) => (
          <Chip
            key={n}
            className="filter-chip filter-kit-chip filter-kit-num"
            pressed={lowValues.includes(n)}
            onClick={() => emit(toggle(lowValues, n), highValues, chips.atLeast)}
          >
            {n}
          </Chip>
        ))}
        <Chip className="filter-chip filter-kit-chip filter-kit-num" pressed={open} onClick={onTop}>
          {top}+
        </Chip>
        <Chip
          className="filter-chip filter-kit-chip"
          pressed={range}
          onClick={() => {
            setPicked(null);
            onChange(range ? EMPTY_VALUE_STRIP : {});
          }}
        >
          Custom…
        </Chip>
      </div>
      {open && (
        <div className="filter-kit-narrow">
          <span className="filter-kit-narrow-note">
            Narrow {top}+ (all of {top} and up while none are picked)
          </span>
          <div
            className="filter-kit-chips"
            role="group"
            aria-label={`Narrow ${valueLabel.toLowerCase()} ${top} and up`}
          >
            {highs.map((n) => (
              <Chip
                key={n}
                className="filter-chip filter-kit-chip filter-kit-num"
                pressed={highValues.includes(n)}
                onClick={() => onHigh(n)}
              >
                {n}
              </Chip>
            ))}
            <Chip
              className="filter-chip filter-kit-chip filter-kit-num"
              pressed={endOn}
              onClick={onEnd}
            >
              {topEnd}+
            </Chip>
          </div>
        </div>
      )}
      {range && (
        <div className="filter-kit-compare">
          <SegmentedControl
            ariaLabel={`${valueLabel} comparison`}
            value={op}
            options={OPS}
            onChange={setOp}
          />
          <input
            className="filter-kit-number"
            type="number"
            inputMode="numeric"
            min={0}
            aria-label={op === 'between' ? `${valueLabel}, from` : valueLabel}
            value={first ?? ''}
            onChange={(e) => setFirst(num(e.target.value))}
          />
          {op === 'between' && (
            <>
              <span aria-hidden="true">and</span>
              <input
                className="filter-kit-number"
                type="number"
                inputMode="numeric"
                min={0}
                aria-label={`${valueLabel}, to`}
                value={value.max ?? ''}
                onChange={(e) => onChange({ min: value.min, max: num(e.target.value) })}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
