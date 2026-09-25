import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import './form.css';

/**
 * The configuration-surface kit (board T139, STYLE_GUIDE § Config surfaces).
 * Each piece has one job; an editor dialog composes them instead of carrying
 * its own checkbox rows, segmented-pill CSS family or disclosure.
 */

/** A sentence-case label, the control, and a hint that is always visible. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Set when the control is a single input, so the label is a real <label>. */
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="form-field">
      {htmlFor ? (
        <label className="form-field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="form-field-label">{label}</span>
      )}
      {children}
      {hint && <p className="form-field-hint">{hint}</p>}
    </div>
  );
}

/**
 * A setting that is on or off: the whole row is a `role="switch"` button, the
 * hint says what On does, and the value reads On / Off. A checkbox is for
 * picking items out of a list, never for a setting.
 */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      aria-describedby={hint ? `${id}-hint` : undefined}
      className="switch-row"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-row-text">
        <span id={`${id}-label`} className="switch-row-label">
          {label}
        </span>
        {hint && (
          <span id={`${id}-hint`} className="switch-row-hint">
            {hint}
          </span>
        )}
      </span>
      <span className="switch-row-value" aria-hidden="true">
        {checked ? 'On' : 'Off'}
      </span>
    </button>
  );
}

export interface Option<T> {
  value: T;
  label: ReactNode;
  /** Visible under the label — ChoiceList only. */
  hint?: ReactNode;
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string;
  /** Shown but not pickable (e.g. Public while signed out). Say why in a hint
   *  or beside the group; a greyed option with no reason is a dead end. */
  disabled?: boolean;
}

/** Two or three short options: native radios in a track. */
export function SegmentedControl<T extends string | number | boolean>({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: T;
  options: Option<T>[];
  onChange: (next: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="segmented" aria-label={ariaLabel}>
      {options.map((o) => (
        <label
          key={String(o.value)}
          className={`segmented-option${o.value === value ? ' is-selected' : ''}${o.disabled ? ' is-disabled' : ''}`}
        >
          <input
            type="radio"
            name={name}
            value={String(o.value)}
            checked={o.value === value}
            disabled={o.disabled}
            aria-label={o.ariaLabel}
            onChange={() => onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** One-of where each option needs a sentence: radio rows, hint always visible. */
export function ChoiceList<T extends string | number | boolean>({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: T;
  options: Option<T>[];
  onChange: (next: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="choice-list" aria-label={ariaLabel}>
      {options.map((o) => (
        <label
          key={String(o.value)}
          className={`choice-option${o.value === value ? ' is-selected' : ''}${o.disabled ? ' is-disabled' : ''}`}
        >
          <input
            type="radio"
            name={name}
            value={String(o.value)}
            checked={o.value === value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
          />
          <span className="choice-option-label">{o.label}</span>
          {o.hint && <span className="choice-option-hint">{o.hint}</span>}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * A collapsed group that states its current value, for settings most people
 * leave at their defaults. Never for identity or for the dialog's main job.
 */
export function Disclosure({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** The current setting, shown while closed so a non-default is never hidden. */
  summary: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className="disclosure">
      <button
        type="button"
        className="disclosure-toggle"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="disclosure-title">{title}</span>
        {!open && <span className="disclosure-summary">{summary}</span>}
        <ChevronDown width={16} height={16} strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <div id={bodyId} className="disclosure-body">
          {children}
        </div>
      )}
    </section>
  );
}
