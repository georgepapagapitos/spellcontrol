import type { ScryfallCard, GeneratedDeck, DeckCategory, ThemeResult } from '@/deck-builder/types';
import { useDeckBuilderStore } from '@/deck-builder/store';
import { useCollectionStore } from '../store/collection';
import { useDecksStore, newDeckCard } from '../store/decks';
import {
  buildAllocationMap,
  pickCollectionCopy,
  makeDeckAllocationInfo,
  type AllocationInfo,
} from './allocations';
import { assembleBuildReport } from '@/deck-builder/services/deckBuilder/buildReport';

/**
 * Persist a generated deck and return its new id. Shared by the one-shot
 * generator (DeckNewPage) and the guided builder so allocation and
 * metadata stay identical across both entry points.
 */
export function saveGeneratedDeck(
  generated: GeneratedDeck,
  customization: ReturnType<typeof useDeckBuilderStore.getState>['customization'],
  selectedThemes: ThemeResult[],
  existingDecks: ReturnType<typeof useDecksStore.getState>['decks'],
  collection: ReturnType<typeof useCollectionStore.getState>['cards'],
  createDeck: ReturnType<typeof useDecksStore.getState>['createDeck']
): string {
  // Build a running allocation map so we never claim the same physical
  // copy twice within a single deck (e.g. when the deck contains
  // duplicates of a non-basic — rare in EDH but possible).
  const claimed = new Map<string, AllocationInfo>(buildAllocationMap(existingDecks));

  const allocateFor = (card: ScryfallCard): string | null => {
    // Pass card.id as the preferred printing so generated-deck allocation
    // respects the printing the builder chose. Without this, allocation
    // falls back to "cheapest same-name" and ignores intent.
    const pick = pickCollectionCopy(card.name, collection, claimed, card.id);
    if (!pick) return null;
    claimed.set(pick.copyId, makeDeckAllocationInfo('__pending__', '__pending__', '', card.name));
    return pick.copyId;
  };

  const commander = generated.commander;
  const partner = generated.partnerCommander;
  const commanderAlloc = commander ? allocateFor(commander) : null;
  const partnerAlloc = partner ? allocateFor(partner) : null;

  const cards = [];
  for (const cat of Object.keys(generated.categories) as DeckCategory[]) {
    for (const card of generated.categories[cat]) {
      cards.push(newDeckCard(card, allocateFor(card)));
    }
  }

  const collectionNames = new Set(collection.map((c) => c.name));

  // Count cards where all owned copies are allocated to other decks.
  let claimedConflicts = 0;
  for (const dc of cards) {
    if (dc.allocatedCopyId === null && collectionNames.has(dc.card.name)) {
      claimedConflicts++;
    }
  }
  if (commander && commanderAlloc === null && collectionNames.has(commander.name))
    claimedConflicts++;
  if (partner && partnerAlloc === null && collectionNames.has(partner.name)) claimedConflicts++;

  const buildReport = assembleBuildReport({
    generated,
    customization,
    collectionNames,
    claimedConflicts: claimedConflicts > 0 ? claimedConflicts : undefined,
    selectedThemes,
  });

  return createDeck({
    source: 'generated',
    // Only PDH generates as its own format today; everything else stays the
    // standard Commander 100 (matches createDeck's own default).
    format: customization.mtgFormat ?? 'commander',
    commander,
    partnerCommander: partner,
    commanderAllocatedCopyId: commanderAlloc,
    partnerCommanderAllocatedCopyId: partnerAlloc,
    cards,
    generationContext: {
      selectedThemes,
      targetBracket: customization.targetBracket,
      landCount: customization.landCount,
      collectionMode: customization.collectionMode,
      generationMode: generated.generationMode ?? customization.generationMode,
      generationModeDetail: generated.generationModeDetail,
    },
    roleCounts: generated.roleCounts,
    rampSubtypeCounts: generated.rampSubtypeCounts,
    removalSubtypeCounts: generated.removalSubtypeCounts,
    boardwipeSubtypeCounts: generated.boardwipeSubtypeCounts,
    cardDrawSubtypeCounts: generated.cardDrawSubtypeCounts,
    bracketEstimation: generated.bracketEstimation,
    deckGrade: generated.deckGrade,
    averageSalt: generated.stats.averageSalt,
    saltiestCards: generated.stats.saltiestCards,
    buildReport,
  });
}
