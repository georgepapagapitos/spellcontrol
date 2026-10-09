import { useId, useMemo } from 'react';
import { X } from 'lucide-react';
import type { DeckFormat, ScryfallCard } from '@/deck-builder/types';
import { Modal } from '@/components/overlays/Modal';
import { IconButton } from '@/components/shared/Button';
import { CommanderSearch } from './CommanderSearch';
import { CommanderResultCard } from './CommanderResultCard';
import { commanderCandidatesFor } from '@/lib/import-export/deck-import-format';
import './CommanderPickerSheet.css';

/**
 * Choose a deck's commander from inside the editor (E465): a deck can start
 * without one, so this is where it gets one later, and where an existing one
 * is changed. A sheet you pick from (STYLE_GUIDE § Overlays, Pattern B): a
 * bottom sheet on phones, a centered dialog above 600px.
 *
 * Leads with the commander-eligible cards already in the deck (format-aware:
 * PDH derives eligibility, the other formats use the legendary rule), which is
 * usually what someone who threw cards together is looking for, then the
 * ordinary `CommanderSearch` for everything else. A pick from either lands in
 * `onPick`; the host decides whether it moves an in-deck slot or claims a
 * copy.
 */
export function CommanderPickerSheet({
  format,
  deckCards,
  exclude,
  onPick,
  onClose,
}: {
  format: DeckFormat;
  /** The deck's mainboard and sideboard cards, in deck order. */
  deckCards: ScryfallCard[];
  /** Names that can't be picked (the commander already seated, its partner). */
  exclude?: string[];
  onPick: (card: ScryfallCard) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const inDeckId = useId();
  const excludeKey = (exclude ?? []).join('\u0000');
  const inDeck = useMemo(() => {
    const skip = new Set(excludeKey ? excludeKey.split('\u0000') : []);
    return commanderCandidatesFor(deckCards, format).filter((c) => !skip.has(c.name));
  }, [deckCards, format, excludeKey]);

  return (
    <Modal
      onClose={onClose}
      className="modal commander-picker-sheet"
      backdropClassName="modal-backdrop--sheet"
      labelledBy={titleId}
    >
      <div className="modal-header">
        <h2 id={titleId}>Choose a commander</h2>
        <IconButton
          variant="quiet"
          label="Close"
          icon={<X width={20} height={20} strokeWidth={1.8} />}
          onClick={onClose}
        />
      </div>
      <div className="modal-body commander-picker-body">
        {inDeck.length > 0 && (
          <section aria-labelledby={inDeckId}>
            <h3 id={inDeckId} className="commander-picker-label">
              In this deck
            </h3>
            <ul className="commander-result-grid">
              {inDeck.map((card) => (
                <li key={card.name}>
                  <CommanderResultCard
                    name={card.name}
                    imageUrl={card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal}
                    colors={card.color_identity ?? []}
                    typeLine={card.type_line}
                    onSelect={() => onPick(card)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
        {inDeck.length > 0 && <h3 className="commander-picker-label">Or search</h3>}
        {/* value={null}: this sheet only ever picks, and a pick closes it,
            so the search never shows its own "selected" state here. The
            binder tab routes to the same handler: it's one more way to find
            a card, and the host claims the owned copy either way. */}
        <CommanderSearch
          value={null}
          format={format}
          onSelect={(card) => {
            if (card) onPick(card);
          }}
          onSelectFromBinder={onPick}
        />
      </div>
    </Modal>
  );
}
