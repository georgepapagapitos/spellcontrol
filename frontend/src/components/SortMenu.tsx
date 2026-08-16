import { ArrowDownUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { SelectMenu } from './SelectMenu';
import { SortDirArrow } from './SortDirArrow';
import type { SortDir } from '../types';

export interface SortMenuOption<T extends string> {
  value: T;
  label: string;
  /**
   * How this field's rows READ in each direction — `[ascending, descending]`.
   * Phrase the effect ("Newest first", "A → Z", "Most played"), never the
   * comparator: ascending release date is newest-LAST while ascending EDHREC
   * rank is most-popular-FIRST, so `asc`/`desc` is ambiguous even to a reader
   * who knows what it means. Card-attribute surfaces get these for free from
   * `sortDirectionLabel()`; entity surfaces (decks, binders, lists) author
   * their own, since their fields aren't in the shared `SortField` union.
   */
  dirLabels: [string, string];
}

interface Props<T extends string> {
  value: T;
  dir: SortDir;
  options: SortMenuOption<T>[];
  /**
   * The surface's existing sort handler. Every one of them already flips
   * direction when handed the field that is already active, which is exactly
   * what Reverse below calls — so no call site needs a second callback, and
   * the long-standing re-select-to-flip gesture keeps working unchanged.
   */
  onChange: (value: T) => void;
  label?: ReactNode;
  ariaLabel?: string;
  className?: string;
}

/**
 * The compact toolbar sort control: one pill that owns BOTH the field and the
 * direction.
 *
 * Direction used to be reversible only by opening the field dropdown and
 * re-picking the field you already had — a gesture with nothing on screen to
 * suggest it existed, repeated verbatim across seven toolbars. The named
 * `Reverse` action in the menu footer is that gesture made visible; the active
 * row states the direction it resolved to, so the menu also answers "which way
 * is this sorted right now?" without a second control.
 *
 * The action lives inside the menu rather than beside the pill because these
 * toolbars are width-budgeted and CI-guarded (STYLE_GUIDE § Toolbars & action
 * rows — display controls collapse into one "View" popover at ≤640px). A
 * second pill on all seven would spend that budget on a control you only reach
 * with the menu already open.
 */
export function SortMenu<T extends string>({
  value,
  dir,
  options,
  onChange,
  label,
  ariaLabel,
  className,
}: Props<T>) {
  const activeOption = options.find((o) => o.value === value);
  const labelFor = (o: SortMenuOption<T>, d: SortDir) => o.dirLabels[d === 'asc' ? 0 : 1];
  const currentDirLabel = activeOption ? labelFor(activeOption, dir) : '';
  const nextDirLabel = activeOption ? labelFor(activeOption, dir === 'asc' ? 'desc' : 'asc') : '';

  return (
    <SelectMenu<T>
      label={label}
      ariaLabel={ariaLabel}
      className={className}
      value={value}
      // Picking a field never dismisses the menu, so Reverse is still there to
      // adjust the pick you just made (STYLE_GUIDE § Anchored panels).
      closeOnSelect={false}
      leadingIcon={<SortDirArrow dir={dir} />}
      options={options.map((o) => ({
        value: o.value,
        // `label` (plain text) stays the trigger's value; `itemLabel` is the
        // in-menu row, which carries the resolved direction on the active one.
        label: o.label,
        itemLabel:
          o.value === value ? (
            <>
              <span className="sort-menu-item-label">{o.label}</span>
              <span className="sort-menu-item-dir">{currentDirLabel}</span>
            </>
          ) : (
            o.label
          ),
      }))}
      onChange={onChange}
      renderItemPrefix={(_o, active) => (active ? <SortDirArrow dir={dir} /> : null)}
      footer={
        activeOption ? (
          <button
            type="button"
            className="sort-menu-reverse"
            onClick={() => onChange(value)}
            // Names the direction it will produce, not the one showing — the
            // button's job is to say what happens if you press it.
            aria-label={`Reverse sort order — ${nextDirLabel}`}
          >
            <ArrowDownUp width={14} height={14} strokeWidth={2} aria-hidden />
            <span className="sort-menu-reverse-label">Reverse</span>
            <span className="sort-menu-reverse-dir" aria-hidden>
              {nextDirLabel}
            </span>
          </button>
        ) : null
      }
    />
  );
}
