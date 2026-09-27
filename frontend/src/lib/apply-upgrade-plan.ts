/**
 * Commit an upgrade plan (E458) to a deck: every cut leaves, every add lands
 * with a free owned copy claimed where one exists, in ONE store write and ONE
 * undo entry. The target deck is a parameter so "Apply to a copy" can apply
 * the same plan to a duplicate.
 */
import { useDecksStore, type DeckCard } from '../store/decks';
import { useCollectionStore } from '../store/collection';
import { useCubeStore } from '../store/cube';
import { useDeckHistoryStore } from '../store/deck-history';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { buildAllocationMap, makeDeckAllocationInfo, pickCollectionCopy } from './allocations';
import { genId } from './id';

export interface PlanStep {
  addName: string;
  /** The card going out, or null when the add fills an empty slot. */
  cutName: string | null;
}

/** Returns how many steps landed. A card that won't resolve is skipped and
 *  its cut stays in the deck, so the deck never loses a slot. */
export async function applyUpgradePlan(deckId: string, steps: PlanStep[]): Promise<number> {
  const cards = await getCardsByNames(steps.map((s) => s.addName));
  const deck = useDecksStore.getState().decks.find((d) => d.id === deckId);
  if (!deck) return 0;

  const allocations = buildAllocationMap(
    useDecksStore.getState().decks,
    useCubeStore.getState().saved
  );
  const collection = useCollectionStore.getState().cards;
  const slotsByName = new Map<string, string[]>();
  for (const c of deck.cards) {
    const k = c.card.name.toLowerCase();
    slotsByName.set(k, [...(slotsByName.get(k) ?? []), c.slotId]);
  }

  const cut = new Set<string>();
  const added: DeckCard[] = [];
  for (const step of steps) {
    const card = cards.get(step.addName);
    if (!card) continue;
    let slotId: string | undefined;
    if (step.cutName) {
      slotId = slotsByName.get(step.cutName.toLowerCase())?.shift();
      if (!slotId) continue;
    }
    const claim = pickCollectionCopy(step.addName, collection, allocations, card.id);
    // Claimed here so a second step can't take the same physical copy.
    if (claim) {
      allocations.set(
        claim.copyId,
        makeDeckAllocationInfo(deckId, deck.name, deck.color, step.addName)
      );
    }
    if (slotId) cut.add(slotId);
    added.push({
      slotId: genId('slot'),
      card,
      allocatedCopyId: claim?.copyId ?? null,
      addedAt: Date.now(),
    });
  }
  if (added.length === 0) return 0;

  const history = useDeckHistoryStore.getState();
  const before = history.begin(deckId);
  useDecksStore.getState().replaceDeck(deckId, {
    ...deck,
    cards: [...deck.cards.filter((c) => !cut.has(c.slotId)), ...added],
  });
  if (before) {
    history.commit(
      deckId,
      `apply upgrade plan (${added.length} ${added.length === 1 ? 'card' : 'cards'})`,
      before
    );
  }
  return added.length;
}
