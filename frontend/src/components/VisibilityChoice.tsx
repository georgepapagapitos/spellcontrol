import { ChoiceList } from './shared/form';

export interface VisibilityOption<T extends string> {
  value: T;
  label: string;
  hint: string;
  /** Shown but not pickable right now (e.g. Public while signed out) — stays
   *  in the group with its hint stating why, never hidden. */
  disabled?: boolean;
}

/**
 * The one "who can see this" control (STYLE_GUIDE "Visibility is one
 * choice, not a link to manage") — a `ChoiceList` under the hood, so every
 * option's hint is always visible, always in Public/Friends/Private order (or,
 * for a kind with no public page of its own, Anyone-with-the-link/Friends/
 * Private). Callers pass exactly the option subset + order they need, and a
 * `disabled` option stays in the group with its hint stating the reason.
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
          disabled: o.disabled,
        }))}
        onChange={onChange}
      />
    </fieldset>
  );
}
