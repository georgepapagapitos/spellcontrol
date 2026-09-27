import { useState } from 'react';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { Chip } from '@/components/shared/Chip';
import type { Deck } from '@/store/decks';
import { DeckFormatSheet } from './DeckFormatSheet';

/**
 * The deck's format, as the first segment of the hero's meta line and the
 * door to changing it (E465). It works the way the sharing status beside it
 * does: the value is the link, and it opens its own sheet.
 */
export function DeckFormatLink({ deck }: { deck: Deck }) {
  const [open, setOpen] = useState(false);
  const label = DECK_FORMAT_CONFIGS[deck.format].label;
  return (
    <>
      <Chip
        className="deck-meta-link deck-format-link"
        labelClassName="deck-meta-link-value"
        onClick={() => setOpen(true)}
        aria-label={`Format: ${label}. Change format`}
      >
        {label}
      </Chip>
      {open && <DeckFormatSheet deck={deck} onClose={() => setOpen(false)} />}
    </>
  );
}
