import { useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import './InlineRename.css';

export interface InlineRenameProps {
  /** The committed value: shown at rest, and what the input is pre-filled + selected with on open. */
  value: string;
  /**
   * Called with the trimmed, changed value on save. Never called for an
   * empty or unchanged value — those revert with no write. May reject
   * (e.g. a failed network rename); on rejection editing stays open so the
   * caller's own error toast has something to point at and the user can
   * retry or press Escape to back out.
   */
  onCommit: (value: string) => void | Promise<void>;
  /** Accessible name for the input (a visually-hidden `<label>`), e.g. "Deck name". */
  label: string;
  /**
   * Accessible name for the resting button, e.g. "Rename deck". When this is
   * the only content of a page heading (PageHeader's `title`, DeckHero's
   * `title`), embed the current value (`Rename ${deck.name}`) so a
   * screen-reader user tabbing straight to the button hears which thing,
   * not just the verb. (The heading's own accessible name comes from its
   * rendered text regardless, so this doesn't affect heading navigation —
   * it's for the button, tabbed to directly.)
   */
  renameLabel: string;
  maxLength?: number;
  placeholder?: string;
  /** Extra class on the resting button, layered on top of the shared look. */
  className?: string;
  /** Extra class on the input, layered on top of the shared look. */
  inputClassName?: string;
  /** Extra class on the editing wrapper. */
  editClassName?: string;
  /** Rendered after the value in the resting button (e.g. a Pencil glyph). */
  icon?: ReactNode;
  /**
   * Renders an explicit save trigger beside the input, for a composite editor
   * where another control inside `children` (a color swatch) can take focus
   * without blurring the group, so blur alone can't be relied on to close it.
   */
  doneLabel?: string;
  /** Controlled editing state, so a caller (a menu item, a route hand-off) can open it. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** Rendered next to the input only while editing (the deck hero's color picker). */
  children?: ReactNode;
}

/**
 * Renaming an existing thing happens in place: the name is the field
 * (STYLE_GUIDE § Verbs — Rename). Activating the resting name swaps it for an
 * input pre-filled and selected; Enter or blur saves; Escape reverts and
 * returns focus to the name; an empty or unchanged value reverts without
 * saving. No toast on save — the user watched it happen.
 *
 * Renders only the interactive part, never a heading — it composes as a page
 * `<h1>`'s content (`PageHeader`'s `title`, `DeckHero`'s `title`) or inline
 * anywhere else a name can be renamed.
 */
export function InlineRename({
  value,
  onCommit,
  label,
  renameLabel,
  maxLength,
  placeholder,
  className,
  inputClassName,
  editClassName,
  icon,
  doneLabel,
  editing: editingProp,
  onEditingChange,
  children,
}: InlineRenameProps) {
  const [editingState, setEditingState] = useState(false);
  const editing = editingProp ?? editingState;
  const setEditing = onEditingChange ?? setEditingState;
  const [draft, setDraft] = useState(value);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();

  // Reseed the draft only when editing starts (not on every `value` change,
  // which would clobber what the user is mid-typing if the committed value
  // changes underneath — e.g. another device's sync landing). `editing` can
  // flip to true from outside (a controlled caller, e.g. a menu item), so
  // this can't just seed the draft at a local click handler; adjusting state
  // during render (rather than an effect) is the React-blessed way to react
  // to that without an extra render.
  const [editingAtLastDraftSeed, setEditingAtLastDraftSeed] = useState(editing);
  if (editing !== editingAtLastDraftSeed) {
    setEditingAtLastDraftSeed(editing);
    if (editing) setDraft(value);
  }

  const commit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      setEditing(false);
      return;
    }
    try {
      await onCommit(trimmed);
      setEditing(false);
    } catch {
      // The caller's onCommit surfaces the failure (a toast); editing stays
      // open so the user can retry or press Escape to back out.
    }
  };

  const revert = () => {
    setDraft(value);
    setEditing(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  if (!editing) {
    return (
      <button
        ref={buttonRef}
        type="button"
        className={['inline-rename-btn', className].filter(Boolean).join(' ')}
        onClick={() => setEditing(true)}
        aria-label={renameLabel}
      >
        <span className="inline-rename-value">{value}</span>
        {icon}
      </button>
    );
  }

  return (
    <div
      className={['inline-rename-edit', editClassName].filter(Boolean).join(' ')}
      role="presentation"
      // A click on a non-text-input child (a color swatch, the Done button)
      // must not blur-commit before its own click handler runs: keep focus
      // put for everything except a real text input, which needs it.
      onMouseDown={(e) => {
        const t = e.target as HTMLElement;
        if (!t.matches('input:not([type="radio"])')) e.preventDefault();
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) void commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          revert();
        }
      }}
    >
      <label className="sr-only" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        autoFocus
        type="text"
        className={['inline-rename-input', inputClassName].filter(Boolean).join(' ')}
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          }
        }}
      />
      {children}
      {doneLabel && (
        <Button variant="primary" onClick={() => void commit()}>
          {doneLabel}
        </Button>
      )}
    </div>
  );
}
