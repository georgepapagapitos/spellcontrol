/**
 * Karsten's MDFC term for the land formula (5.4a): a spell/land MDFC counts as
 * 0.38 of a land (0.74 when mythic), and the formula subtracts the sum.
 *
 * Generation needs it before any card is picked, so it reads the lands the
 * commander's EDHREC page plays at the same inclusion bar the role targets use
 * (`EDHREC_INCLUSION_THRESHOLD`) and keeps the ones that are spell/land MDFCs
 * (`isMdfcLand`: Pathways, Land // Land, are plain lands and do not count). It
 * is fetched only when the auto land count will run, so a build that sets its
 * lands pays for nothing and changes nothing.
 */
import type {
  Customization,
  DeckSize,
  EDHRECCommanderData,
  ScryfallCard,
} from '@/deck-builder/types';
import { isMdfcLand } from '@/deck-builder/services/scryfall/client';
import { EDHREC_INCLUSION_THRESHOLD } from '../roleTargets';
import {
  isDefaultLandCount,
  karstenAppliesToFormat,
  KARSTEN_FULL_LAND_TERMS,
  mdfcLandWeight,
} from '../targetCounts';

/** The summed land worth of the spell/land MDFCs among `cards`. */
export function mdfcLandTermOf(cards: Iterable<ScryfallCard>): number {
  let term = 0;
  for (const card of cards) if (isMdfcLand(card)) term += mdfcLandWeight(card.rarity);
  return term;
}

export async function expectedMdfcLandTerm(input: {
  format: DeckSize;
  customization: Pick<Customization, 'landCount' | 'nonBasicLandCount' | 'landsExplicit'>;
  edhrecData: EDHRECCommanderData | null | undefined;
  fetchCards: (names: string[]) => Promise<ReadonlyMap<string, ScryfallCard>>;
}): Promise<number> {
  const { format, customization, edhrecData } = input;
  if (!KARSTEN_FULL_LAND_TERMS || !edhrecData) return 0;
  if (!karstenAppliesToFormat(format) || !isDefaultLandCount(customization)) return 0;
  const names = [
    ...new Set(
      edhrecData.cardlists.lands
        .filter((land) => land.inclusion >= EDHREC_INCLUSION_THRESHOLD)
        .map((land) => land.name)
    ),
  ];
  if (names.length === 0) return 0;
  return mdfcLandTermOf((await input.fetchCards(names)).values());
}
