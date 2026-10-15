import { Button } from '@/components/shared/Button';
import { Chip } from '@/components/shared/Chip';
import { SegmentedControl } from '@/components/shared/form';
import { ManaSymbol } from '@/components/shared/ManaSymbol';
import {
  FLAGS,
  NAMES,
  PAD_SYMBOLS,
  countOf,
  manaCostSummary,
  type ManaCostFilter,
  type PadSymbol,
} from './mana-cost';
import './filter-kit.css';

export interface ManaSymbolPadProps {
  value: ManaCostFilter;
  onChange: (next: ManaCostFilter) => void;
}

/**
 * Builds a mana cost to match by tapping symbols: each tap adds one (a second
 * tap on black counts two black), shown as a badge on the symbol and as the
 * built cost in the tray, which Clear empties. Below it the match mode, the
 * shortcut chips for what a cost can't spell (X, hybrid, Phyrexian, no colored
 * symbols, no cost) and a sentence saying what the cost matches.
 */
export function ManaSymbolPad({ value, onChange }: ManaSymbolPadProps) {
  const add = (s: PadSymbol) =>
    onChange({ ...value, counts: { ...value.counts, [s]: countOf(value, s) + 1 } });
  const tray = PAD_SYMBOLS.flatMap((s) => Array.from({ length: countOf(value, s) }, () => s));
  return (
    <div className="filter-kit-pad">
      <div className="filter-kit-symbols" role="group" aria-label="Add a mana symbol">
        {PAD_SYMBOLS.map((s) => {
          const n = countOf(value, s);
          return (
            <button
              key={s}
              type="button"
              className="filter-kit-symbol"
              aria-label={n ? `Add ${NAMES[s]}, ${n} added` : `Add ${NAMES[s]}`}
              onClick={() => add(s)}
            >
              <ManaSymbol symbol={s.toLowerCase()} cost pip />
              {n > 0 && (
                <span className="filter-kit-symbol-count" aria-hidden="true">
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="filter-kit-tray">
        {tray.length === 0 ? (
          <span className="filter-kit-tray-empty">Tap symbols above</span>
        ) : (
          <span className="filter-kit-tray-cost" aria-hidden="true">
            {tray.map((s, i) => (
              <ManaSymbol key={i} symbol={s.toLowerCase()} cost />
            ))}
          </span>
        )}
        {tray.length > 0 && (
          <Button
            variant="link"
            className="filter-kit-clear"
            onClick={() => onChange({ ...value, counts: {} })}
          >
            Clear
          </Button>
        )}
      </div>
      <SegmentedControl
        ariaLabel="How the cost matches"
        value={value.mode}
        options={[
          { value: 'atLeast', label: 'At least these' },
          { value: 'exact', label: 'Exactly these colored' },
        ]}
        onChange={(mode) => onChange({ ...value, mode })}
      />
      <div className="filter-kit-chips" role="group" aria-label="Mana cost shortcuts">
        {FLAGS.map((f) => (
          <Chip
            key={f.key}
            className="filter-chip filter-kit-chip"
            pressed={!!value[f.key]}
            onClick={() => onChange({ ...value, [f.key]: !value[f.key] })}
          >
            {f.label}
          </Chip>
        ))}
      </div>
      <p className="filter-kit-hint" aria-live="polite">
        {manaCostSummary(value)}
      </p>
    </div>
  );
}
