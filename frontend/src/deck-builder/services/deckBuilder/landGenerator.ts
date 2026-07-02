// Land base generation: non-basic land selection (EDHREC + Scryfall fallback),
// channel/MDFC/tapland pacing boosts, and pip-proportional basics.
// Extracted verbatim from deckGenerator.ts.
import { logger } from '@/lib/logger';
import { BASIC_LAND_NAMES } from '@/lib/allocations';
import { planBasicPrintings, type BasicPrintingAvail } from '@/lib/collection-availability';
import type {
  EDHRECCard,
  ScryfallCard,
  MaxRarity,
  DeckSize,
  CollectionStrategy,
  Pacing,
} from '@/deck-builder/types';
import {
  getCardsByNames,
  upgradeCardPrintings,
  isChannelLand,
  isMdfcLand,
  CHANNEL_LANDS,
  getCardByName,
  getCachedCard,
} from '@/deck-builder/services/scryfall/client';
import { isTapland } from '@/deck-builder/services/tagger/client';
import { BudgetTracker } from './budgetTracker';
import { pickFromPrefetched } from './cardPicking';
import { fillWithScryfall } from './scryfallFill';
import { constrainsToCollection, notInCollection } from './deckFilters';
import { planBasicColorSplit } from './manabaseMath';

// Basic land names to filter out from EDHREC suggestions — canonical set lives
// in lib/allocations; re-exported here so existing './landGenerator' importers
// keep working.
export { BASIC_LAND_NAMES };

/** Priority boost for Kamigawa channel lands — near-auto-includes in their color. */
export const CHANNEL_LAND_BOOST = 80;
/** Priority boost for MDFC spell/lands — strictly better than spell-only equivalents. */
export const MDFC_LAND_BOOST = 50;

const TAPLAND_PENALTIES: Record<Pacing, number> = {
  'aggressive-early': -30,
  'fast-tempo': -20,
  balanced: -10,
  midrange: -5,
  'late-game': 0,
};

// Stamp a basic-land copy with a real owned printing (id/set/collector_number)
// so the deck binds to the user's actual copies, or fall back to the default
// printing when unowned (`p === null`). Copies of the same printing share
// `card.id`, so the deck view aggregates them into one row instead of N rows.
function stampBasic(basicCard: ScryfallCard, p: BasicPrintingAvail | null): ScryfallCard {
  if (!p) return { ...basicCard };
  return {
    ...basicCard,
    id: p.scryfallId,
    set: p.set,
    collector_number: p.collectorNumber,
    set_name: p.setName,
  };
}

// Count color pips across all cards' mana costs (including hybrid mana)
export function countColorPips(cards: ScryfallCard[]): Record<string, number> {
  const pips: Record<string, number> = {};
  // Match any mana symbol: {W}, {U/B}, {2/R}, {G/P}, etc.
  const symbolPattern = /\{([^}]+)\}/g;
  const colorLetters = new Set(['W', 'U', 'B', 'R', 'G']);
  for (const card of cards) {
    const costs: string[] = [];
    if (card.mana_cost) costs.push(card.mana_cost);
    // Double-faced cards store mana cost on each face
    if (card.card_faces) {
      for (const face of card.card_faces) {
        if (face.mana_cost) costs.push(face.mana_cost);
      }
    }
    for (const cost of costs) {
      let match;
      while ((match = symbolPattern.exec(cost)) !== null) {
        // Extract every color letter from the symbol (handles hybrid like W/U, 2/R, G/P)
        for (const char of match[1]) {
          if (colorLetters.has(char)) {
            pips[char] = (pips[char] || 0) + 1;
          }
        }
      }
    }
  }
  return pips;
}

// Generate lands from EDHREC data + basics
export async function generateLands(
  edhrecLands: EDHRECCard[],
  colorIdentity: string[],
  count: number,
  usedNames: Set<string>,
  basicCount: number,
  format: DeckSize,
  nonLandCards: ScryfallCard[],
  onProgress?: (message: string, percent: number) => void,
  bannedCards: Set<string> = new Set(),
  maxCardPrice: number | null = null,
  maxRarity: MaxRarity = null,
  maxCmc: number | null = null,
  budgetTracker: BudgetTracker | null = null,
  collectionNames?: Set<string>,
  collectionAvailableCounts?: Map<string, number>,
  currency: 'USD' | 'EUR' = 'USD',
  arenaOnly: boolean = false,
  scryfallQuery: string = '',
  preferredSet?: string,
  collectionStrategy: CollectionStrategy = 'full',
  collectionOwnedPercent: number = 100,
  ignoreOwnedBudget: boolean = false,
  ignoreOwnedRarity: boolean = false,
  pacing: Pacing = 'balanced',
  priorityBoosts?: Map<string, number>,
  basicPrintings?: Map<string, BasicPrintingAvail[]>
): Promise<ScryfallCard[]> {
  const lands: ScryfallCard[] = [];
  const enforceAvailableCounts = collectionStrategy === 'available';
  const availableCount = (name: string): number =>
    enforceAvailableCounts ? (collectionAvailableCounts?.get(name) ?? 0) : Infinity;

  // Filter out basic lands from EDHREC suggestions - we add those separately
  const nonBasicEdhrecLands = edhrecLands.filter((land) => !BASIC_LAND_NAMES.has(land.name));

  logger.debug('[DeckGen] generateLands:', {
    totalEdhrecLands: edhrecLands.length,
    nonBasicEdhrecLands: nonBasicEdhrecLands.length,
    basicTarget: basicCount,
    totalTarget: count,
  });

  // First, get non-basic lands from EDHREC
  const nonBasicTarget = count - basicCount;

  if (nonBasicTarget > 0 && nonBasicEdhrecLands.length > 0) {
    onProgress?.('Loading utility lands', 82);
    logger.debug(
      `[DeckGen] Picking ${nonBasicTarget} non-basic lands from ${nonBasicEdhrecLands.length} EDHREC suggestions`
    );

    // Batch fetch candidate lands — fetch more than needed to account for filtering
    const landNamesToFetch = nonBasicEdhrecLands
      .filter((c) => !usedNames.has(c.name) && !bannedCards.has(c.name))
      .slice(0, nonBasicTarget * 2)
      .map((c) => c.name);

    // Ensure channel lands for this color identity are always fetched and in
    // the candidate list, even if EDHREC doesn't recommend them for this commander
    const edhrecLandNames = new Set(nonBasicEdhrecLands.map((c) => c.name));
    for (const [name, color] of Object.entries(CHANNEL_LANDS)) {
      if (!colorIdentity.includes(color) || usedNames.has(name) || bannedCards.has(name)) continue;
      if (!landNamesToFetch.includes(name)) landNamesToFetch.push(name);
      if (!edhrecLandNames.has(name)) {
        nonBasicEdhrecLands.push({
          name,
          sanitized: name,
          primary_type: 'Land',
          inclusion: 0,
          num_decks: 0,
        });
      }
    }

    const landCardMap = await getCardsByNames(landNamesToFetch, undefined, preferredSet);
    if (preferredSet) {
      for (const [name, card] of landCardMap) {
        if (card.set !== preferredSet) landCardMap.delete(name);
      }
    }
    await upgradeCardPrintings(landCardMap, scryfallQuery, true);

    // Build priority boost / penalty map for pacing-aware land selection
    const landPenalties = new Map<string, number>();

    // Flex land boosts: channel lands and MDFCs have low EDHREC inclusion but are
    // format staples — boost aggressively so they're picked over generic lands.
    for (const [name, card] of landCardMap) {
      if (isChannelLand(card)) {
        landPenalties.set(name, (landPenalties.get(name) ?? 0) + CHANNEL_LAND_BOOST);
      } else if (isMdfcLand(card)) {
        landPenalties.set(name, (landPenalties.get(name) ?? 0) + MDFC_LAND_BOOST);
      }
    }

    // Tapland penalties based on deck pacing
    const basePenalty = TAPLAND_PENALTIES[pacing];
    if (basePenalty !== 0) {
      for (const [name, card] of landCardMap) {
        if (isTapland(name)) {
          // MDFC taplands get half penalty — the spell side compensates
          const penalty = isMdfcLand(card) ? Math.round(basePenalty / 2) : basePenalty;
          landPenalties.set(name, (landPenalties.get(name) ?? 0) + penalty);
        }
      }
    }

    // Merge any external priority boosts
    if (priorityBoosts) {
      for (const [name, boost] of priorityBoosts) {
        landPenalties.set(name, (landPenalties.get(name) ?? 0) + boost);
      }
    }

    const nonBasics = pickFromPrefetched(
      nonBasicEdhrecLands,
      landCardMap,
      nonBasicTarget,
      usedNames,
      colorIdentity,
      bannedCards,
      maxCardPrice,
      Infinity,
      { value: 0 },
      maxRarity,
      maxCmc,
      budgetTracker,
      collectionNames,
      landPenalties.size > 0 ? landPenalties : undefined,
      currency,
      new Set(),
      arenaOnly,
      collectionStrategy,
      collectionOwnedPercent,
      ignoreOwnedBudget,
      ignoreOwnedRarity
    );
    lands.push(...nonBasics);
    logger.debug(
      `[DeckGen] Got ${nonBasics.length} non-basic lands:`,
      nonBasics.map((l) => l.name)
    );
  }

  // If we didn't get enough from EDHREC, search Scryfall for more
  if (lands.length < nonBasicTarget) {
    onProgress?.('Selecting non-basic lands', 87);
    const query =
      colorIdentity.length > 0
        ? `t:land (${colorIdentity.map((c) => `o:{${c}}`).join(' OR ')}) -t:basic`
        : `t:land id:c -t:basic`;
    const moreLands = await fillWithScryfall(
      query,
      colorIdentity,
      nonBasicTarget - lands.length,
      usedNames,
      bannedCards,
      maxCardPrice,
      maxRarity,
      maxCmc,
      budgetTracker,
      collectionNames,
      currency,
      arenaOnly,
      scryfallQuery,
      collectionStrategy,
      ignoreOwnedBudget,
      ignoreOwnedRarity
    );
    lands.push(...moreLands);
  }

  // Add Command Tower for multicolor Commander decks (unless banned)
  if (
    format === 99 &&
    colorIdentity.length >= 2 &&
    !usedNames.has('Command Tower') &&
    !bannedCards.has('Command Tower') &&
    !(
      constrainsToCollection(collectionStrategy) &&
      notInCollection('Command Tower', collectionNames)
    ) &&
    availableCount('Command Tower') > 0
  ) {
    try {
      const commandTower = await getCardByName('Command Tower', true);
      lands.push(commandTower);
      usedNames.add('Command Tower');
    } catch {
      // Ignore if not found
    }
  }

  // Fill remaining with basic lands (use cached cards for efficiency)
  const basicsNeeded = Math.max(0, count - lands.length);
  const basicTypes: Record<string, string> = {
    W: 'Plains',
    U: 'Island',
    B: 'Swamp',
    R: 'Mountain',
    G: 'Forest',
  };

  const colorsWithBasics = colorIdentity.filter((c) => basicTypes[c]);

  if (colorsWithBasics.length > 0 && basicsNeeded > 0) {
    onProgress?.('Adding basic lands', 92);

    // Split basics to close each color's residual source deficit — weighted pip
    // demand vs what the picked nonbasics + the deck's rocks/dorks already
    // produce (see manabaseMath). Falls back to pip proportion, then even split.
    const landsPerColor = planBasicColorSplit({
      nonLandCards,
      pickedLands: lands,
      identity: new Set(colorIdentity),
      colors: colorsWithBasics,
      basicsNeeded,
    });

    logger.debug('[DeckGen] Basic land distribution by residual deficit:', { landsPerColor });

    for (const color of colorsWithBasics) {
      const basicName = basicTypes[color];
      const countForColor = Math.min(landsPerColor[color], availableCount(basicName));

      // Try to get cached basic land first (prefetched at start of deck generation)
      let basicCard = getCachedCard(basicName);
      if (!basicCard) {
        try {
          basicCard = await getCardByName(basicName, true);
        } catch {
          continue; // Skip if can't fetch
        }
      }

      // Split copies across the user's owned printings (largest group first)
      // so the deck pulls real stacks of their basics — 12 of one Forest
      // printing + 8 of another — instead of N copies of one default printing.
      const plan = planBasicPrintings(countForColor, basicPrintings?.get(basicName) ?? []);
      for (const p of plan) lands.push(stampBasic(basicCard, p));
    }
  } else if (colorsWithBasics.length === 0 && basicsNeeded > 0) {
    // Colorless deck — use Wastes as the basic land
    onProgress?.('Adding basic lands', 92);
    let wastesCard = getCachedCard('Wastes');
    if (!wastesCard) {
      try {
        wastesCard = await getCardByName('Wastes', true);
      } catch {
        // Skip if can't fetch
      }
    }
    if (wastesCard) {
      const countForColor = Math.min(basicsNeeded, availableCount('Wastes'));
      const plan = planBasicPrintings(countForColor, basicPrintings?.get('Wastes') ?? []);
      for (const p of plan) lands.push(stampBasic(wastesCard, p));
    }
  }

  return lands.slice(0, count);
}
