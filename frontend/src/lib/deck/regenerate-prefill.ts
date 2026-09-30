import type { Deck } from '@/store/decks';
import { deckEdits } from './regenerate-edits';

/**
 * Router state that sends a generated deck back to the generator with its own
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
      edits: deckEdits(deck) ?? undefined,
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

/** Where a regenerate lands: the generator, in the source deck's format (a
 *  PDH regenerate must stay PDH). Paired with {@link regenerateState}. */
export function regenerateHref(deck: Pick<Deck, 'format'>): string {
  return `/decks/new/generate?format=${deck.format}`;
}

/** Regenerate needs the settings a generator produced and a commander to
 *  rebuild around; a hand-built or imported deck has neither to replay. */
export function canRegenerate(deck: Pick<Deck, 'source' | 'commander'>): boolean {
  return deck.source === 'generated' && !!deck.commander;
}
