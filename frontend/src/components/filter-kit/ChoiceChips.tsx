import { useId, type ReactElement, type ReactNode } from 'react';
import { Chip } from '@/components/shared/Chip';
import './filter-kit.css';

export interface ChoiceOption {
  value: string;
  label: ReactNode;
  /** Leading glyph, rendered `aria-hidden`. */
  icon?: ReactElement<{ 'aria-hidden'?: boolean }>;
  /** Plain-text name when `label` is not text. */
  ariaLabel?: string;
}

interface Common {
  /** Names the group for assistive tech ("Filter by rarity"). */
  ariaLabel: string;
  options: ChoiceOption[];
}

/** Pick any of the values: `aria-pressed` toggle chips. `value` is the picked values. */
interface Multiple extends Common {
  multiple: true;
  value: readonly string[];
  onChange: (next: string[]) => void;
  anyLabel?: never;
}

/**
 * Pick one: native radio inputs painted as chips. `anyLabel` adds a leading
 * "Any" option whose value is `''`: the reset, and what `value` holds when
 * nothing is picked.
 */
interface Single extends Common {
  multiple?: false;
  value: string;
  onChange: (next: string) => void;
  anyLabel?: string;
}

export type ChoiceChipsProps = Multiple | Single;

/** For any list of up to about ten values (STYLE_GUIDE § Filter kit). */
export function ChoiceChips(props: ChoiceChipsProps) {
  const name = useId();
  if (props.multiple) {
    const { ariaLabel, options, value, onChange } = props;
    return (
      <div className="filter-kit-chips" role="group" aria-label={ariaLabel}>
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <Chip
              key={o.value}
              className="filter-chip filter-kit-chip"
              icon={o.icon}
              pressed={on}
              aria-label={o.ariaLabel}
              onClick={() =>
                onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])
              }
            >
              {o.label}
            </Chip>
          );
        })}
      </div>
    );
  }
  const { ariaLabel, options, value, onChange, anyLabel } = props;
  const all: ChoiceOption[] = anyLabel ? [{ value: '', label: anyLabel }, ...options] : options;
  return (
    <fieldset className="filter-kit-chips filter-kit-fieldset" aria-label={ariaLabel}>
      {all.map((o) => (
        <label key={o.value} className="filter-kit-radio">
          <input
            className="overlay-input"
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            aria-label={o.ariaLabel}
            onChange={() => onChange(o.value)}
          />
          <span className="filter-chip filter-kit-chip">
            {o.icon && <span aria-hidden="true">{o.icon}</span>}
            {o.label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
