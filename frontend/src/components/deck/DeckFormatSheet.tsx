import './DeckFormatSheet.css';
import { useId, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Modal } from '../Modal';
import { Button, IconButton } from '../shared/Button';
import { ChoiceList } from '../shared/form';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { DeckFormat } from '@/deck-builder/types';
import { convertDeckFormat, describeFormatSwitch } from '@/lib/deck/convert-deck-format';
import { useDecksStore, type Deck } from '@/store/decks';
import { useDeckHistoryStore } from '@/store/deck-history';
import { useToastsStore } from '@/store/toasts';

const FORMATS = Object.keys(DECK_FORMAT_CONFIGS) as DeckFormat[];

/** One line per format, the rule a player checks first. The sideboard cap of
 *  the 60-card formats is left out: nothing enforces it (board E468). */
const FORMAT_HINTS: Record<DeckFormat, string> = {
  commander: '99 cards + commander',
  brawl: '59 cards + commander',
  paupercommander: '99 commons + an uncommon commander',
  standard: '60 cards, up to 4 copies',
  pauper: '60 commons, up to 4 copies',
  modern: '60 cards, up to 4 copies',
  pioneer: '60 cards, up to 4 copies',
  legacy: '60 cards, up to 4 copies',
  vintage: '60 cards, up to 4 copies',
};

interface Props {
  deck: Deck;
  onClose: () => void;
}

/**
 * Change a deck's format after it's made (E465). The formats are a
 * ChoiceList; picking one shows what the switch does to THIS deck before the
 * player commits. The switch is one `replaceDeck` inside one `recordEdit`, so
 * it is a single write and a single undo, and nothing is ever removed, which
 * is why there is no second confirm (STYLE_GUIDE § Verbs).
 */
export function DeckFormatSheet({ deck, onClose }: Props) {
  const titleId = useId();
  const [target, setTarget] = useState<DeckFormat>(deck.format);
  const replaceDeck = useDecksStore((s) => s.replaceDeck);
  const recordEdit = useDeckHistoryStore((s) => s.record);
  const undoEdit = useDeckHistoryStore((s) => s.undo);
  const pushToast = useToastsStore((s) => s.push);

  const changing = target !== deck.format;
  const label = DECK_FORMAT_CONFIGS[target].label;
  const consequences = useMemo(() => describeFormatSwitch(deck, target), [deck, target]);

  const confirm = () => {
    if (!changing) return;
    const next = convertDeckFormat(deck, target);
    recordEdit(deck.id, `switch to ${label}`, () => replaceDeck(deck.id, next));
    onClose();
    pushToast({
      message: `Switched to ${label}`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => undoEdit(deck.id),
    });
  };

  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      className="modal deck-format-sheet"
      backdropClassName="modal-backdrop--sheet"
    >
      <div className="modal-header">
        <h2 id={titleId}>Format</h2>
        <IconButton
          variant="quiet"
          onClick={onClose}
          label="Close"
          icon={<X width={20} height={20} strokeWidth={1.8} />}
        />
      </div>

      <div className="modal-body deck-format-sheet-body">
        <ChoiceList<DeckFormat>
          ariaLabel="Format"
          value={target}
          onChange={setTarget}
          options={FORMATS.map((f) => ({
            value: f,
            label: DECK_FORMAT_CONFIGS[f].label,
            hint: f === deck.format ? `${FORMAT_HINTS[f]} · Current` : FORMAT_HINTS[f],
          }))}
        />
        <div aria-live="polite">
          {changing && (
            <section className="deck-format-consequences" aria-labelledby={`${titleId}-what`}>
              <h3 id={`${titleId}-what`} className="deck-format-consequences-title">
                Switching to {label}
              </h3>
              <ul className="deck-format-consequences-list">
                {consequences.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <div className="modal-footer deck-format-sheet-footer">
        <Button onClick={onClose} className="deck-format-sheet-cancel">
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!changing}
          onClick={confirm}
          className="deck-format-sheet-confirm"
        >
          Switch to {label}
        </Button>
      </div>
    </Modal>
  );
}
