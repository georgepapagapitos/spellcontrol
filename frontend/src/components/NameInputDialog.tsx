import { useId, useState, type ReactNode } from 'react';
import { Modal } from './Modal';

interface Props {
  title: string;
  /** Field label above the input. */
  label: string;
  /** Pre-filled value (e.g. the current name when renaming). */
  initialValue?: string;
  confirmLabel?: string;
  placeholder?: string;
  /** Extra form content rendered between the input and the actions
   *  (e.g. an options radio group). Caller owns its state. */
  children?: ReactNode;
  /** Called with the trimmed, non-empty name. */
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

/**
 * Shared "name this thing" prompt: the themed Modal + a single text input.
 * Replaces native `window.prompt`, which breaks the app theme and the native
 * (Capacitor) feel. Submits on Enter, disables the action when empty, and
 * focuses the field on open.
 */
export function NameInputDialog({
  title,
  label,
  initialValue = '',
  confirmLabel = 'Save',
  placeholder,
  children,
  onSubmit,
  onCancel,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const titleId = useId();
  const inputId = useId();
  const trimmed = value.trim();

  return (
    <Modal onClose={onCancel} labelledBy={titleId}>
      <h2 id={titleId} className="choice-dialog-title">
        {title}
      </h2>
      <form
        className="name-input-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) onSubmit(trimmed);
        }}
      >
        <label className="name-input-label" htmlFor={inputId}>
          {label}
        </label>
        <input
          id={inputId}
          className="name-input-field"
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        {children}
        <div className="choice-dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!trimmed}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
