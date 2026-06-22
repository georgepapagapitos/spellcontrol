import { useId, useState } from 'react';
import type { ListDef } from '../types';
import { Modal } from './Modal';

const NEW_LIST = '__new';

interface Props {
  /** How many cards the current filter would save (for the title). */
  cardCount: number;
  /** Existing lists to choose from. */
  lists: ListDef[];
  /** Add to an existing list, or create one with the given name. */
  onSubmit: (target: { listId: string } | { newName: string }) => void;
  onCancel: () => void;
}

/**
 * "Save these N cards to a list" picker: choose an existing list or name a new
 * one. With no lists yet, it collapses to just the new-list input. Dedup of
 * already-present cards happens in the store (`addListEntries`), so this dialog
 * only collects the destination. Reuses the shared choice-dialog option rows.
 */
export function SaveToListDialog({ cardCount, lists, onSubmit, onCancel }: Props) {
  const titleId = useId();
  const newNameId = useId();
  // Default to the first existing list; with none, force the new-list path.
  const [selected, setSelected] = useState<string>(() => lists[0]?.id ?? NEW_LIST);
  const [newName, setNewName] = useState('');

  const isNew = selected === NEW_LIST;
  const trimmed = newName.trim();
  const canSave = !isNew || trimmed.length > 0;

  const submit = () => {
    if (!canSave) return;
    onSubmit(isNew ? { newName: trimmed } : { listId: selected });
  };

  const option = (value: string, title: string, desc?: string) => {
    const active = selected === value;
    return (
      <button
        key={value}
        type="button"
        aria-pressed={active}
        className={`choice-dialog-option${active ? ' choice-dialog-option-active' : ''}`}
        onClick={() => setSelected(value)}
      >
        <span className="choice-dialog-option-title">{title}</span>
        {desc && <span className="choice-dialog-option-desc">{desc}</span>}
      </button>
    );
  };

  return (
    <Modal onClose={onCancel} labelledBy={titleId}>
      <h2 id={titleId} className="choice-dialog-title">
        Save {cardCount.toLocaleString()} {cardCount === 1 ? 'card' : 'cards'} to a list
      </h2>
      <form
        className="name-input-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {lists.length > 0 && (
          <div className="choice-dialog-options" role="group" aria-label="Choose a list">
            {lists.map((l) =>
              option(
                l.id,
                l.name,
                `${l.entries.length} ${l.entries.length === 1 ? 'card' : 'cards'}`
              )
            )}
            {option(NEW_LIST, 'New list…')}
          </div>
        )}

        {isNew && (
          <>
            <label className="name-input-label" htmlFor={newNameId}>
              List name
            </label>
            <input
              id={newNameId}
              className="name-input-field"
              type="text"
              value={newName}
              placeholder="e.g. Ramp pieces"
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
          </>
        )}

        <div className="choice-dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSave}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
