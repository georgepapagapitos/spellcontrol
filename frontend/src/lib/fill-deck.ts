import type { Customization, ScryfallCard } from '@/deck-builder/types';
import { generateDeck } from '@/deck-builder/services/deckBuilder/deckGenerator';
import { defaultCustomization } from '@/deck-builder/store';
import { getCurrency } from './currency';
import { deckColorIdentity } from './deck-validation';
import { planFill, type FillPlan } from './fill-deck-plan';
import type { Deck } from '../store/decks';

export interface FillOptions {
  /** Staples <-> Synergy dial, 0..1 (see calculateCardPriority). */
  brewLevel: number;
  /** Owned-first ranking ('prefer'): the best deck, leaning on what you own. */
  preferOwned: boolean;
}

export interface FillResult {
  plan: FillPlan;
  /** Card name → the generator's own reason for picking it. */
  reasons: Record<string, string>;
  /** Data problems the build ran into (EDHREC or tagger data missing). */
  notes: string[];
}

const isBasic = (c: ScryfallCard) => /\bBasic\b/.test((c.type_line ?? '').split('//')[0]);

/**
 * Build the rest of a part-built Commander deck around the cards already in
 * it. Every nonbasic card in the mainboard goes to the generator as a
 * must-include of the 'deck' kind (the build-from-deck hook it has carried
 * since the original port, which no screen used), so the rest is picked to
 * fit them: its lift seeds, combo detection and role targets all see the
 * player's own cards. Basics are left to planFill, which counts them.
 *
 * Starts from the builder's default settings rather than whatever the
 * new-deck page last held, so a budget from an unrelated build can't leak in.
 */
export async function buildFill(
  deck: Deck,
  target: number,
  options: FillOptions,
  env: { ownedNames?: Set<string>; onProgress?: (message: string, percent: number) => void }
): Promise<FillResult> {
  if (!deck.commander) throw new Error('Fill needs a commander deck.');
  const current = deck.cards.map((c) => c.card);
  const customization: Customization = {
    ...defaultCustomization,
    currency: getCurrency(),
    mtgFormat: deck.format === 'paupercommander' ? 'paupercommander' : 'commander',
    brewLevel: options.brewLevel,
    collectionMode: false,
    collectionStrategy: options.preferOwned ? 'prefer' : defaultCustomization.collectionStrategy,
    mustIncludeCards: [],
    tempMustIncludeCards: [],
    tempBannedCards: [],
  };
  const generated = await generateDeck({
    commander: deck.commander,
    partnerCommander: deck.partnerCommander,
    colorIdentity: [...deckColorIdentity(deck.commander, deck.partnerCommander)],
    customization,
    selectedThemes: deck.generationContext?.selectedThemes ?? [],
    collectionNames: options.preferOwned ? env.ownedNames : undefined,
    optimizeDeckCards: [...new Set(current.filter((c) => !isBasic(c)).map((c) => c.name))],
    onProgress: env.onProgress,
  });
  return {
    plan: planFill(
      current,
      Object.values(generated.categories).flat(),
      target,
      generated.cardRelevancyMap ?? {}
    ),
    reasons: generated.cardProvenance ?? {},
    notes: generated.integrityNotes ?? [],
  };
}
