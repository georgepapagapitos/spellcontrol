import { useCallback, useState } from 'react';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import { scryfallToEnrichedCard } from '../../lib/scryfall-to-enriched';
import type { EnrichedCard } from '../../types';
import type { ComboCardRef } from '../../types/combos';
import type { buildCardIndex } from '../../lib/deck-card-index';

type CardIndex = ReturnType<typeof buildCardIndex>;

/**
 * Card-carousel state for a combo row's thumbnails, shared by the deck-editor
 * combos panel and the collection-wide combos view so both resolve art the
 * same way: local indexes first (free), then a Scryfall lookup for the gaps —
 * a combo piece the user doesn't own has no local row to resolve from.
 *
 * Lives under components/deck/ rather than lib/ because it's view state, not
 * a domain helper.
 */
export function useComboPreview(cardIndex: CardIndex) {
  const [cards, setCards] = useState<EnrichedCard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [title, setTitle] = useState('');

  const open = useCallback(
    async (comboCards: ComboCardRef[], tappedIndex: number) => {
      const resolved: EnrichedCard[] = [];
      for (const ref of comboCards) {
        let card =
          cardIndex.byOracle.get(ref.oracleId) ??
          cardIndex.byName.get(ref.cardName.toLowerCase()) ??
          null;
        if (!card) {
          try {
            const scryfall = await getCardByName(ref.cardName);
            if (scryfall) card = scryfallToEnrichedCard(scryfall);
          } catch {
            /* leave null — skip this card in the carousel */
          }
        }
        if (card) resolved.push(card);
      }
      if (resolved.length === 0) return;
      setCards(resolved);
      // Clamp in case a card couldn't be resolved.
      setIndex(Math.min(tappedIndex, resolved.length - 1));
      setTitle(comboCards.map((c) => c.cardName).join(' + '));
    },
    [cardIndex]
  );

  const close = useCallback(() => setCards(null), []);

  return { cards, index, title, open, close, setIndex };
}
