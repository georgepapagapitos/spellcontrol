import { GAME_CHANGERS_AS_OF, HARDCODED_GAME_CHANGERS } from '@spellcontrol/deck-metrics';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ComboMatchResponse } from '@/types/combos';
import type { DeckImportResponse } from '@/types/index';
import {
  computeRoleCounts,
  detectCombosForAnalysis,
} from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import {
  estimateBracket,
  type BracketEstimation,
} from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { commanderCandidatesFor } from '@/lib/import-export/deck-import-format';

/**
 * The public bracket checker's logic (`/bracket`, E1090): a pasted list in, the
 * same estimate the deck's Power tab shows out. Nothing here is a second
 * estimator. It builds the inputs `buildEdhrecMissingResult` builds (role
 * counts, average mana value of the non-lands, the Game Changers set, the
 * detected combos) and hands them to the shared `estimateBracket`, so the page
 * and the deck view cannot disagree about a list.
 */

/** The Game Changers the page lists and scores against, sorted, with the date it was checked. */
export const GAME_CHANGERS_LIST: readonly string[] = [...HARDCODED_GAME_CHANGERS].sort((a, b) =>
  a.localeCompare(b)
);
export { GAME_CHANGERS_AS_OF };

/** "February 9, 2026" for the list's ISO as-of date. */
export function formatAsOf(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Who can lead the pasted list: the commander the list named under its
 * Commander header, then every legendary creature in it. Empty when the list
 * names none, which is the page's cue to ask.
 */
export function commanderOptions(result: DeckImportResponse): ScryfallCard[] {
  const pool = commanderCandidatesFor(result.cards, 'commander');
  const named = result.commander;
  return named ? [named, ...pool.filter((c) => c.name !== named.name)] : pool;
}

/** The commander to preselect: the one the list named, else the only candidate. */
export function defaultCommander(result: DeckImportResponse): ScryfallCard | null {
  if (result.commander) return result.commander;
  const options = commanderOptions(result);
  return options.length === 1 ? options[0] : null;
}

/**
 * The 99: the pasted cards without the commander(s). A named commander comes
 * back apart from `cards`; an unnamed one is a plain row in it, so both paths
 * filter by name.
 */
export function mainboardOf(
  result: DeckImportResponse,
  commander: ScryfallCard | null,
  partner: ScryfallCard | null
): ScryfallCard[] {
  const out = new Set([commander?.name, partner?.name].filter((n): n is string => !!n));
  return result.cards.filter((c) => !out.has(c.name));
}

/** Names of the list's cards that are on the Game Changers list, in list order, once each. */
export function gameChangersIn(cardNames: Iterable<string>): string[] {
  const inDeck = new Set(cardNames);
  return GAME_CHANGERS_LIST.filter((n) => inDeck.has(n));
}

export interface CheckedDeck {
  estimation: BracketEstimation;
  mainboard: ScryfallCard[];
  commanders: ScryfallCard[];
  gameChangers: string[];
}

/**
 * Estimates a pasted Commander list. Tagger data must already be loaded (the
 * page waits for it before calling): without it every tutor, wipe and extra
 * turn reads as absent and the estimate is quietly low.
 */
export async function checkPastedDeck(args: {
  mainboard: ScryfallCard[];
  commanders: ScryfallCard[];
  combos: ComboMatchResponse | null;
}): Promise<CheckedDeck> {
  const { mainboard, commanders, combos } = args;
  const { roleCounts } = computeRoleCounts(mainboard);
  const nonLand = mainboard.filter((c) => !frontTypeLine(c).toLowerCase().includes('land'));
  const averageCmc =
    nonLand.length > 0 ? nonLand.reduce((s, c) => s + (c.cmc ?? 0), 0) / nonLand.length : 0;
  const allCardNames = [...mainboard, ...commanders].map((c) => c.name);
  const detected = await detectCombosForAnalysis(combos, [...mainboard, ...commanders]);
  const estimation = estimateBracket(
    allCardNames,
    detected,
    averageCmc,
    undefined,
    roleCounts,
    new Set(HARDCODED_GAME_CHANGERS),
    commanders.map((c) => c.name)
  );
  return { estimation, mainboard, commanders, gameChangers: gameChangersIn(allCardNames) };
}

function frontTypeLine(card: ScryfallCard): string {
  return card.card_faces?.[0]?.type_line || card.type_line || '';
}
