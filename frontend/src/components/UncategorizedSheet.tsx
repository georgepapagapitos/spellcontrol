import { useMemo } from 'react';
import { Modal } from './Modal';
import { Button } from './shared/Button';
import { useCollectionStore } from '../store/collection';
import { suggestBinders } from '../lib/binder-suggestions';
import type { EnrichedCard } from '../types';

interface Props {
  /** The copies no binder takes, from the same materialize pass as the index. */
  cards: EnrichedCard[];
  onClose: () => void;
}

/**
 * What to do with the cards no binder takes: a binder built from the biggest
 * idea in the pile, a catch-all for the rest, or a look at the cards.
 *
 * Picking a binder opens the rules editor already filled in, the same seeded
 * path "Save as binder" uses, so the user sees "N cards land here" and can
 * change anything before it exists.
 */
export function UncategorizedSheet({ cards, onClose }: Props) {
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const suggestions = useMemo(() => suggestBinders(cards), [cards]);
  const total = cards.length;
  const noun = total === 1 ? 'card' : 'cards';

  const seed = (name: string, filter = {}) => {
    onClose();
    setEditingBinder('new', { name, groups: [{ filter }] });
  };

  return (
    <Modal onClose={onClose} labelledBy="uncategorized-title">
      <h2 id="uncategorized-title" className="choice-dialog-title">
        {total.toLocaleString()} {noun} in no binder
      </h2>
      <p className="choice-dialog-body">
        No binder's rules match {total === 1 ? 'this card' : 'these cards'}, so{' '}
        {total === 1 ? 'it has' : 'they have'} no page yet. Make a binder for them:
      </p>
      <div className="choice-dialog-options">
        {suggestions.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className="choice-dialog-option"
            onClick={() => seed(s.name, s.filter)}
            autoFocus={i === 0}
          >
            <span className="choice-dialog-option-title">{s.name}</span>
            <span className="choice-dialog-option-desc">
              {s.count.toLocaleString()} of these {noun} · {s.description}
            </span>
          </button>
        ))}
        <button
          type="button"
          className="choice-dialog-option"
          onClick={() => seed('Everything else')}
          autoFocus={suggestions.length === 0}
        >
          <span className="choice-dialog-option-title">Everything else</span>
          <span className="choice-dialog-option-desc">
            No rules, last in line: {total === 1 ? 'this card' : `all ${total.toLocaleString()}`}{' '}
            and anything your binders pass on later.
          </span>
        </button>
      </div>
      <div className="choice-dialog-actions">
        <Button to="/collection?binder=__uncategorized" onClick={onClose}>
          See the {noun}
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
