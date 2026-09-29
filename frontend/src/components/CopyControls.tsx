import type { ReactNode } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Condition, Finish } from '../types';
import { Field, SegmentedControl } from './shared/form';
import { conditionLabel, conditionShort } from './shared/CardRow';
import {
  CONDITIONS,
  FINISH_LABELS,
  availableFinishes,
  finishUnitPrice,
} from '@/lib/scanner/scanner-feedback';
import { formatMoney } from '@/lib/collection/format-money';
import './CopyControls.css';

/**
 * The details of one physical copy, chosen the same way everywhere a copy is
 * made (the add picker, the scanner's edit sheet): every option in view, one
 * tap each. They replaced a pill dropdown per field (T153), which hid all but
 * the current value and read as a toolbar filter, not a form.
 */

const FINISH_ORDER: Finish[] = ['nonfoil', 'foil', 'etched'];

/**
 * Finish, with each one's price under its name. Non-foil and foil are always
 * shown (etched only for a printing that has it), and a finish the printing
 * was never made in stays in the row, disabled, with the reason beneath: hiding
 * it would teach that the choice doesn't exist (§ Config surfaces).
 */
export function FinishControl({
  printing,
  value,
  onChange,
}: {
  printing: ScryfallCard;
  value: Finish;
  onChange: (next: Finish) => void;
}) {
  const made = availableFinishes(printing.finishes);
  const shown = FINISH_ORDER.filter((f) => f !== 'etched' || made.includes(f));
  const missing = shown.filter((f) => !made.includes(f));
  return (
    <Field
      label="Finish"
      hint={
        missing.length > 0
          ? `Not printed in ${missing.map((f) => FINISH_LABELS[f].toLowerCase()).join(' or ')}.`
          : undefined
      }
    >
      <SegmentedControl<Finish>
        fill
        ariaLabel="Finish"
        value={value}
        onChange={onChange}
        options={shown.map((f) => {
          const price = made.includes(f) ? finishUnitPrice(printing.prices, f) : null;
          return {
            value: f,
            disabled: !made.includes(f),
            ariaLabel:
              price != null ? `${FINISH_LABELS[f]}, ${formatMoney(price)}` : FINISH_LABELS[f],
            label: (
              <span className="copy-finish">
                {FINISH_LABELS[f]}
                {price != null && <small>{formatMoney(price)}</small>}
              </span>
            ),
          };
        })}
      />
    </Field>
  );
}

/**
 * Condition as the grading shorthand collectors already use (NM LP MP HP DMG),
 * all five in view; the hint spells out the one that's picked, so the codes
 * have a path to their meaning (§ Glyph literacy).
 *
 * `value` is nullable and `hint` overridable for the edit dialog's group-edit
 * case: a stack whose copies disagree on condition shows no grade selected
 * (`value={null}`) behind a caller-supplied "Mixed: …" hint, rather than
 * silently pre-picking one copy's grade for the whole stack.
 */
export function ConditionControl({
  value,
  onChange,
  hint,
}: {
  value: Condition | null;
  onChange: (next: Condition) => void;
  hint?: ReactNode;
}) {
  return (
    <Field label="Condition" hint={hint ?? conditionLabel(value ?? 'nm')}>
      <SegmentedControl<Condition | ''>
        fill
        ariaLabel="Condition"
        value={value ?? ''}
        onChange={(next) => {
          if (next !== '') onChange(next);
        }}
        options={CONDITIONS.map((c) => ({
          value: c,
          label: <span className="copy-condition">{conditionShort(c)}</span>,
          ariaLabel: conditionLabel(c),
        }))}
      />
    </Field>
  );
}
