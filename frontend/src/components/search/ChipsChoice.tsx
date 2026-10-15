import type { ChipExpression } from '@/types/index';
import { SegmentedControl, type Option } from '@/components/shared/form';
import { ChoiceChips, type ChoiceOption } from '@/components/filter-kit';
import { ChipExpressionBuilder } from './ChipExpressionBuilder';

const EMPTY_EXPR: ChipExpression = { chips: [], joiners: [] };

type Combine = 'any' | 'all';
const COMBINE_OPTIONS: Option<Combine>[] = [
  { value: 'any', label: 'Any of these' },
  { value: 'all', label: 'All of these' },
];

/**
 * The picked values of an expression the chips can say exactly: every chip
 * is an IS (no NOT) and the joiners are all one kind. Anything else (a mixed
 * AND/OR, a NOT) is richer than a row of chips and returns null, so a saved
 * rule keeps its ChipExpressionBuilder instead of being flattened.
 */
function chipsAsChoice(expr: ChipExpression | undefined): {
  values: string[];
  combine: Combine;
} | null {
  const e = expr ?? EMPTY_EXPR;
  if (e.chips.some((c) => c.negate)) return null;
  const ands = e.joiners.filter((j) => j === 'AND').length;
  if (ands !== 0 && ands !== e.joiners.length) return null;
  return { values: e.chips.map((c) => c.value), combine: ands > 0 ? 'all' : 'any' };
}

function toExpression(values: string[], combine: Combine): ChipExpression {
  return {
    chips: values.map((value) => ({ value, negate: false })),
    joiners: values.slice(1).map(() => (combine === 'all' ? 'AND' : 'OR')),
  };
}

/**
 * A small closed vocabulary (rarity, format, finish, treatment, border,
 * layout) as the kit's `ChoiceChips`, writing the same `ChipExpression` the
 * rule always stored. `lockOr` is for a field a card has exactly one of
 * (rarity, finish): "all of" can never match, so it is not offered. A saved
 * expression the chips cannot say (NOT, mixed AND/OR) falls back to the
 * builder it was made with.
 */
export function ChipsChoice({
  value,
  onChange,
  options,
  ariaLabel,
  noun,
  lockOr = false,
}: {
  value: ChipExpression | undefined;
  onChange: (next: ChipExpression) => void;
  options: ChoiceOption[];
  ariaLabel: string;
  /** Plural noun for the combine control and the builder's placeholder. */
  noun: string;
  lockOr?: boolean;
}) {
  const choice = chipsAsChoice(value);
  const known = new Set(options.map((o) => o.value));
  const fallback = (
    <ChipExpressionBuilder
      options={options.map((o) => ({ value: o.value, label: String(o.label) }))}
      value={value ?? EMPTY_EXPR}
      onChange={onChange}
      defaultJoiner="OR"
      lockJoiner={lockOr ? 'OR' : undefined}
      placeholder={`Add ${noun}…`}
    />
  );
  if (!choice || (lockOr && choice.combine === 'all' && choice.values.length > 1)) return fallback;
  if (choice.values.some((v) => !known.has(v))) return fallback;
  const combine = lockOr ? 'any' : choice.combine;
  return (
    <div className="rule-choice">
      <ChoiceChips
        multiple
        ariaLabel={ariaLabel}
        options={options}
        value={choice.values}
        onChange={(next) => onChange(toExpression(next, combine))}
      />
      {!lockOr && choice.values.length > 1 && (
        <SegmentedControl
          ariaLabel={`How the ${noun} combine`}
          value={combine}
          options={COMBINE_OPTIONS}
          onChange={(c) => onChange(toExpression(choice.values, c))}
        />
      )}
    </div>
  );
}
