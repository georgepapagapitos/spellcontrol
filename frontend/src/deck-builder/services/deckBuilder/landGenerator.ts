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
  searchCards,
  commanderSearchIdentity,
} from '@/deck-builder/services/scryfall/client';
import { isTapland } from '@/deck-builder/services/tagger/client';
import { BudgetTracker } from './budgetTracker';
import { pickFromPrefetched } from './cardPicking';
import { fillWithScryfall, type FillHardGates } from './scryfallFill';
import { constrainsToCollection, notInCollection } from './deckFilters';
import { planBasicColorSplit, weightedColorDemand, WUBRG } from './manabaseMath';
import { producedManaColors } from '@/lib/mana-sources';
import { landPowerScore } from './landPower';

/** Ceiling for the color-deficit nonbasic boost — a bounded re-rank (below the
 *  MDFC/channel boosts), never a new eligibility path. */
export const COLOR_DEMAND_BOOST_MAX = 25;

// Basic land names to filter out from EDHREC suggestions — canonical set lives
// in lib/allocations; re-exported here so existing './landGenerator' importers
// keep working.
export { BASIC_LAND_NAMES };

/** Priority boost for Kamigawa channel lands — near-auto-includes in their color. */
export const CHANNEL_LAND_BOOST = 80;
/** Priority boost for MDFC spell/lands — strictly better than spell-only equivalents. */
export const MDFC_LAND_BOOST = 50;
/** Ceiling for the intrinsic land-power (merit) boost (E116). Bounded re-rank —
 *  scaled by landPowerScore/100 — so a genuinely strong land EDHREC hasn't rated
 *  yet (0 inclusion) can compete with mid-inclusion staples, without steamrolling
 *  a proven high-inclusion pick. Sized between COLOR_DEMAND (25) and MDFC (50). */
export const LAND_POWER_BOOST_MAX = 40;
/** How many newest on-identity nonbasic lands to seed into the candidate pool
 *  beyond EDHREC's list — the merit-widen that lets brand-new lands be seen. */
const MERIT_POOL_MAX = 40;

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
  basicPrintings?: Map<string, BasicPrintingAvail[]>,
  // Same hard gates every other pick path enforces (E71 controls audit).
  // Without this, lands bypass the game-changer cap AND never get flagged
  // isGameChanger — Field of the Dead lands unnoticed in a Bracket-2 deck.
  gates?: FillHardGates
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

    // Merit widen (E116): EDHREC's `lands` list can't yet include a strong
    // brand-new land, and the Scryfall fallback below only fires on a shortfall
    // (and is itself edhrec_rank-ordered, which buries new prints). Seed the
    // candidate pool with the newest on-identity nonbasic lands so a genuinely
    // strong new land is at least SEEN; the landPowerScore boost below is what
    // lets it out-rank filler on merit. Zero-inclusion candidates, same shape as
    // the channel-land injection above. Best-effort — a failure leaves the
    // EDHREC-sourced pool + shortfall fallback intact.
    //
    // Plain nonbasic lands only — MDFC spell/lands are excluded: they already
    // carry MDFC_LAND_BOOST (+50), so widening the pool with off-EDHREC MDFCs
    // let that boost over-select them against higher-inclusion plain utility
    // lands (the E116 A/B lost Phyrexian Tower / Urborg / Bojuka Bog on Meren
    // to MDFCs). The widen's real job is the PLAIN fixers EDHREC misses — new
    // duals / rainbow lands — which is also the headline use case.
    try {
      const meritQuery =
        colorIdentity.length > 0
          ? `t:land (${colorIdentity.map((c) => `o:{${c}}`).join(' OR ')}) -t:basic`
          : `t:land id:c -t:basic`;
      const meritResp = await searchCards(meritQuery, commanderSearchIdentity(colorIdentity), {
        order: 'released',
      });
      let added = 0;
      for (const card of meritResp.data) {
        if (added >= MERIT_POOL_MAX) break;
        if (usedNames.has(card.name) || bannedCards.has(card.name)) continue;
        if (landCardMap.has(card.name)) continue;
        if (isMdfcLand(card)) continue;
        landCardMap.set(card.name, card);
        if (!edhrecLandNames.has(card.name)) {
          edhrecLandNames.add(card.name);
          nonBasicEdhrecLands.push({
            name: card.name,
            sanitized: card.name,
            primary_type: 'Land',
            inclusion: 0,
            num_decks: 0,
          });
        }
        added++;
      }
    } catch {
      // Ignore — the EDHREC-sourced pool + Scryfall fallback still apply.
    }

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

    // Color-demand boost: nudge lands that produce the colors this deck's
    // costs actually lean on (weighted pip demand), so an on-color dual
    // outranks an off-color utility land at similar inclusion and utility
    // never starves color sources. Bounded re-rank: EDHREC priority stays
    // primary; a 5-color fixer earns the full cap, colorless utility earns 0.
    const demand = weightedColorDemand(nonLandCards);
    const identitySet = new Set(colorIdentity);
    const totalDemand = WUBRG.reduce((s, c) => s + (identitySet.has(c) ? demand[c] : 0), 0);
    if (totalDemand > 0) {
      for (const [name, card] of landCardMap) {
        const produced = producedManaColors(card, identitySet);
        let share = 0;
        for (const c of WUBRG) {
          if (identitySet.has(c) && produced.includes(c)) share += demand[c] / totalDemand;
        }
        const boost = Math.round(COLOR_DEMAND_BOOST_MAX * Math.min(1, share));
        if (boost > 0) landPenalties.set(name, (landPenalties.get(name) ?? 0) + boost);
      }
    }

    // Merit boost (E116): scale the intrinsic land-power score into a bounded
    // re-rank so a strong land with little/no EDHREC inclusion (especially a new
    // one seeded by the merit widen above) competes with mid-inclusion staples.
    // Popularity stays primary via calculateCardPriority; this is a nudge on top,
    // like the color-demand boost, never a new eligibility gate.
    //
    // Skip channel + MDFC lands: they already get their own dedicated boosts
    // (CHANNEL_LAND_BOOST / MDFC_LAND_BOOST) above, and landPowerScore rewards
    // the same traits — stacking a third boost double-counts them and floods the
    // manabase with MDFCs at the cost of high-inclusion untapped duals (observed
    // in the E116 A/B on Sythis). Merit's unique job is the lands those boosts
    // DON'T cover — plain fixers, especially new ones.
    for (const [name, card] of landCardMap) {
      if (isChannelLand(card) || isMdfcLand(card)) continue;
      const merit = landPowerScore(card, identitySet);
      if (merit > 0) {
        const boost = Math.round((LAND_POWER_BOOST_MAX * merit) / 100);
        landPenalties.set(name, (landPenalties.get(name) ?? 0) + boost);
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
      gates?.maxGameChangers ?? Infinity,
      gates?.gameChangerCount ?? { value: 0 },
      maxRarity,
      maxCmc,
      budgetTracker,
      collectionNames,
      landPenalties.size > 0 ? landPenalties : undefined,
      currency,
      gates?.gameChangerNames ?? new Set(),
      arenaOnly,
      collectionStrategy,
      collectionOwnedPercent,
      ignoreOwnedBudget,
      ignoreOwnedRarity,
      gates?.isSaltBlocked ? (card) => !gates.isSaltBlocked!(card.name) : undefined
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
      ignoreOwnedRarity,
      undefined,
      undefined,
      gates
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

    // Colors whose basic fetch failed even after a retry — reallocated below
    // to an already-fetched basic instead of silently shrinking the land
    // count (the old behavior: `continue` with no fallback, see Fix 1 in
    // iter-6 Slice B).
    const failedBasics: { basicName: string; countForColor: number }[] = [];
    let fallbackBasic: { basicName: string; basicCard: ScryfallCard } | undefined;

    for (const color of colorsWithBasics) {
      const basicName = basicTypes[color];
      const countForColor = Math.min(landsPerColor[color], availableCount(basicName));

      // Try to get cached basic land first (prefetched at start of deck generation)
      let basicCard = getCachedCard(basicName);
      if (!basicCard) {
        try {
          basicCard = await getCardByName(basicName, true);
        } catch {
          try {
            basicCard = await getCardByName(basicName, true); // retry once
          } catch {
            failedBasics.push({ basicName, countForColor });
            continue;
          }
        }
      }

      fallbackBasic ??= { basicName, basicCard };
      // Split copies across the user's owned printings (largest group first)
      // so the deck pulls real stacks of their basics — 12 of one Forest
      // printing + 8 of another — instead of N copies of one default printing.
      const plan = planBasicPrintings(countForColor, basicPrintings?.get(basicName) ?? []);
      for (const p of plan) lands.push(stampBasic(basicCard, p));
    }

    // Reallocate any color that failed both attempts to the first basic that
    // did fetch successfully, so a transient fetch blip drops the deck's
    // requested land count instead of the specific color's count.
    if (failedBasics.length > 0 && fallbackBasic) {
      for (const { countForColor } of failedBasics) {
        const plan = planBasicPrintings(
          countForColor,
          basicPrintings?.get(fallbackBasic.basicName) ?? []
        );
        for (const p of plan) lands.push(stampBasic(fallbackBasic.basicCard, p));
      }
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
