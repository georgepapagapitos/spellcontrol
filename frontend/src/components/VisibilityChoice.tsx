import { ChoiceList } from './shared/form';

export interface VisibilityOption<T extends string> {
  value: T;
  label: string;
  hint: string;
}

/**
 * The shared "who can see this" control (STYLE_GUIDE "Visibility is one
 * choice, not a link to manage") — one native radio group, applied the
 * moment it's picked, always in Public/Friends/Private order (or, for a kind
 * with no public page of its own, Anyone-with-the-link/Friends/Private).
 * Callers pass exactly the option subset + order they need.
 *
 * Used by ShareDialog and the PlayPage host form (Public/Private only there —
 * see PlayPage.tsx for why Friends isn't offered yet).
 *
 * NOTE (T139 kit gap, reported to the coordinator): DeckNewPage and
 * ImportDeckDialog's creation-time fieldsets need Public (and Friends)
 * DISABLED with a reason when the viewer is signed out or offline.
 * `components/shared/form`'s `ChoiceList`/`Option<T>` has no per-option
 * `disabled` field, so those two dialogs still carry their own hand-rolled
 * `.share-audience` radio group rather than this component (see the
 * `T139 kit gap` comment at each of their fieldsets). Once `Option<T>` grows
 * an optional `disabled` (ChoiceList setting it on the `<input>`, plus a
 * `.choice-option.is-disabled` style), swap their fieldset for this
 * component with a `disabled` per option — no other change needed here.
 */
export function VisibilityChoice<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  busyValue,
  disabled,
}: {
  ariaLabel?: string;
  value: T;
  options: VisibilityOption<T>[];
  onChange: (next: T) => void;
  /** Shows "Saving…" in place of this option's label while a pick is in flight. */
  busyValue?: T | null;
  /** Disables every option — nested fieldsets disable their descendants
   *  regardless of ChoiceList's own markup, so no kit change is needed here. */
  disabled?: boolean;
}) {
  return (
    <fieldset
      disabled={disabled}
      aria-busy={!!busyValue || undefined}
      style={{ border: 0, margin: 0, padding: 0 }}
    >
      <ChoiceList<T>
        ariaLabel={ariaLabel ?? 'Who can see it'}
        value={value}
        options={options.map((o) => ({
          value: o.value,
          label: busyValue === o.value ? 'Saving…' : o.label,
          hint: o.hint,
        }))}
        onChange={onChange}
      />
    </fieldset>
  );
}
