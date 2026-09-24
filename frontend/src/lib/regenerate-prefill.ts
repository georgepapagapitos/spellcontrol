import type { Deck } from '../store/decks';

/**
 * Router state that sends a generated deck back to /decks/new with its own
 * settings, themes and partner, for a Regenerate that lands on the compare
 * diff. One builder for every surface that offers it (the decks index tile and
 * the deck page), so the two can't drift on what a regenerate carries.
 */
export function regenerateState(deck: Deck) {
  return {
    prefill: {
      sourceDeckId: deck.id,
      format: deck.format,
      commander: deck.commander,
      partnerCommander: deck.partnerCommander,
      customization: deck.generationContext?.customization,
      themes: (deck.generationContext?.selectedThemes ?? []).map((t) => ({
        name: t.name,
        slug: t.slug ?? '',
        count: t.deckCount ?? 0,
        url: '',
        popularityPercent: t.popularityPercent,
      })),
      targetBracket: deck.generationContext?.targetBracket ?? 'all',
      landCount: deck.generationContext?.landCount ?? 37,
      collectionMode: deck.generationContext?.collectionMode ?? false,
    },
  };
}

/** Regenerate needs the settings a generator produced and a commander to
 *  rebuild around; a hand-built or imported deck has neither to replay. */
export function canRegenerate(deck: Pick<Deck, 'source' | 'commander'>): boolean {
  return deck.source === 'generated' && !!deck.commander;
}
