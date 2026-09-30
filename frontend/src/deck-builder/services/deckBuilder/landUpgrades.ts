/**
 * Land-upgrade engine — the per-deck "Re-analyze lands" tool.
 *
 * Given a deck's current lands and a pool of candidate lands for its colors —
 * the ones the user OWNS but isn't running, plus strong on-color duals from
 * Scryfall the user may not own yet — it proposes safe, explainable swaps: cut
 * a weak land (a basic, a tapland, a land that only fetches a basic) for a
 * land that makes more of this deck's colors without costing tempo. Owned
 * candidates become apply-now swaps; unowned ones become "acquire"
 * suggestions. Nothing here silently mutates a deck; every move is a `Change`
 * the user approves.
 *
 * Merit is `landSlotMerit`, this engine's own reading of a land as a mana
 * source for THIS deck, not generation's `landPowerScore` (left as it is).
 * T171 lane L counted 97 applied land swaps that were downgrades, from two
 * readings of `landPowerScore` that suit picking a manabase and not replacing
 * one card of it: a land that fetches a basic counted as a source of every
 * color it could find (Evolving Wilds read as a four-color untapped fixer),
 * and a land whose value isn't its colors (Yavimaya, Castle Garenbrig,
 * Takenuma, Reliquary Tower) scored like a tapped basic and became the cut.
 * Here:
 *  - a land that does more than make mana (`isUtilityLand`) is never cut;
 *  - a land that only fetches a basic counts as one basic, tapped or not;
 *  - an incoming land enters untapped (or conditionally), makes more of the
 *    deck's colors, and is not a utility land this engine can't judge
 *    (Cavern of Souls, Nykthos). Channel lands are the exception: a strict
 *    upgrade over the basic of their color.
 *
 * Safety: a swap is only proposed when the incoming land covers every color
 * the outgoing land produced (no color regression) and beats it by a clear
 * margin. Basics the deck's own basic fetchers need stay (two per fetcher).
 * Each land is used at most once per side. A land you already OWN is
 * preferred over an unowned one of comparable merit.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { fitsColorIdentity } from '@/lib/deck/deck-validation';
import { producedManaColors, isManaSourceType } from '@/lib/deck-analysis/mana-sources';
import { isBasicLandName } from '@/lib/collection/allocations';
import { isChannelLand, isMdfcLand } from '../scryfall/client';
import { weightedColorDemand, colorSourceCounts, fetchedBasicRequirement } from './manabaseMath';
import { isColorShort, shortfallThresholdsForCurve } from './colorShortfall';
import { countBasicFetchers } from './deckAnalyzer';
import { isPremiumCard } from './premiumCards';

/** Only cut plain lands below this merit — an untapped or checked dual never is. */
const WEAK_LAND_CEILING = 50;
/** Require this much merit gain, so we don't churn near-equal lands. */
const UPGRADE_MARGIN = 8;
/** Cap proposals so the lane stays scannable. */
const MAX_UPGRADES = 8;
/** Merit points an owned candidate wins over an unowned one when picking for a
 *  slot — keeps an owned land ahead of a marginally-better unowned one, so we
 *  only ever suggest acquiring a land that's a clear upgrade over your pool. */
const OWNED_PREFERENCE = 6;
/** Basics kept per basic fetcher in the deck (Cultivate can take two). */
const BASICS_PER_FETCHER = 2;

export interface LandUpgradeMove {
  /** Current deck land being cut (by name — the page resolves it to a slot). */
  outName: string;
  outCard: ScryfallCard;
  /** Candidate land being added. */
  inName: string;
  inCard: ScryfallCard;
  /** Whether the user owns a copy — owned = apply-now swap, else = "acquire". */
  owned: boolean;
  /** Grounded, human "why this is better". */
  reason: string;
  outScore: number;
  inScore: number;
  /** Short colors this incoming land helps cover (WUBRG letters, for the "why"). */
  fixesShortColors: string[];
  /** Colors it adds that the cut land didn't make (WUBRG letters). */
  addsColors: string[];
}

const COLOR_KEYS = ['W', 'U', 'B', 'R', 'G'] as const;

function isLand(card: ScryfallCard): boolean {
  const front = (card.type_line || card.card_faces?.[0]?.type_line || '').toLowerCase();
  const back = (card.card_faces?.[1]?.type_line || '').toLowerCase();
  return front.includes('land') || back.includes('land');
}

function frontOracle(card: ScryfallCard): string {
  return (card.oracle_text ?? card.card_faces?.[0]?.oracle_text ?? '')
    .replace(/\([^)]*\)/g, '')
    .toLowerCase();
}

/** Searches only for a basic: Evolving Wilds, the Panoramas, Escape Tunnel, Ash Barrens. */
export function fetchesOnlyBasics(card: ScryfallCard): boolean {
  const ot = frontOracle(card);
  return /search your library for [^.]*\bbasic\b/.test(ot) || /\bbasic landcycling\b/.test(ot);
}

/**
 * Lines of a land's rules text that only describe its mana, its tempo or a
 * one-shot: tapping for mana (with or without a life payment), entering
 * tapped, a fetch, a pain clause, an enters trigger (gain 1, scry 1, return a
 * land), cycling, a sacrifice ability, choosing a color. Anything else is the
 * land doing something a basic can't. `~` stands for the land's own name.
 */
const PLAIN_LAND_LINE = [
  /^\{t\}(?:, pay \d+ life)?: add\b/,
  /enters (?:the battlefield )?tapped/,
  /^as ~ enters/,
  /search your library/,
  /deals? \d+ damage to you/,
  /^when ~ enters/,
  /cycling/,
  /sacrifice ~:/,
];

/**
 * A land whose value isn't only its colors: a channel land, an MDFC, a
 * legendary land, a static rule (Yavimaya's "each land is a Forest",
 * Reliquary Tower), or a repeatable ability beyond plain mana (Castle
 * Garenbrig's six mana, Rogue's Passage, a creature land). Never a cut target.
 */
export function isUtilityLand(card: ScryfallCard): boolean {
  if (!isLand(card) || isBasicLandName(card.name)) return false;
  if (isChannelLand(card) || isMdfcLand(card)) return true;
  if (/\blegendary\b/i.test(card.type_line ?? card.card_faces?.[0]?.type_line ?? '')) return true;
  const ot = frontOracle(card);
  // Mana it can only spend on some spells (Cavern of Souls, Castle Garenbrig)
  // isn't general fixing, whatever colors it names.
  if (/spend this mana only/.test(ot)) return true;
  const self = [card.name.toLowerCase(), 'this land'];
  return ot
    .split('\n')
    .map((l) => self.reduce((line, n) => line.split(n).join('~'), l).trim())
    .filter(Boolean)
    .some((line) => !PLAIN_LAND_LINE.some((re) => re.test(line)));
}

type Entry = 'untapped' | 'conditional' | 'tapped';

function entersAs(card: ScryfallCard): Entry {
  const ot = frontOracle(card);
  // A fetch that puts its land onto the battlefield tapped is a tapped source.
  if (/onto the battlefield tapped/.test(ot))
    return /untap that land/.test(ot) ? 'conditional' : 'tapped';
  // Read the condition in the tapped sentence itself: Public Thoroughfare's
  // "unless" and Shimmerdrift Vale's "as it enters" belong to other sentences,
  // and both lands always enter tapped.
  const tapped = ot.split(/[.\n]/).filter((s) => /enters (?:the battlefield )?tapped/.test(s));
  if (tapped.length === 0) return 'untapped';
  return tapped.some((s) => /unless|if you don'?t|if you control/.test(s))
    ? 'conditional'
    : 'tapped';
}

/** The deck-identity colors a land supplies as a source. */
function sourceColors(card: ScryfallCard, identity: ReadonlySet<string>): Set<string> {
  const out = new Set(producedManaColors(card, identity).filter((c) => identity.has(c)));
  // A typed fetch (Polluted Delta: "an Island or Swamp card") finds duals too,
  // so it supplies both colors. A basic-only fetch supplies whichever basic is
  // left in the library, and landSlotMerit reads it as one basic.
  const req = fetchedBasicRequirement(card);
  if (req && !req.anyBasic && !fetchesOnlyBasics(card)) {
    for (const c of req.colors) if (identity.has(c)) out.add(c);
  }
  return out;
}

function painPenalty(card: ScryfallCard): number {
  const ot = frontOracle(card);
  if (/deals? \d+ damage to you/.test(ot)) return 6;
  if (/pay \d+ life[,.:]?\s*(?:and [^:]*)?add\b/.test(ot)) return 4;
  return 0;
}

/**
 * A land's merit as a mana source for this deck, 0–100: the colors of the
 * deck's identity it supplies and whether it costs a turn to do so. A basic is
 * 10; a land that only fetches a basic is one tapped basic (6), or a basic (10)
 * when it arrives untapped; an untapped two-color land is 58, a tapped one 44;
 * channel lands and MDFCs earn their spell side on top of their colors.
 */
export function landSlotMerit(card: ScryfallCard, identity: ReadonlySet<string>): number {
  if (!isLand(card)) return 0;
  if (isBasicLandName(card.name)) return 10;
  const entry = entersAs(card);
  if (fetchesOnlyBasics(card)) return entry === 'tapped' ? 6 : 10;
  // Exotic Orchard makes only what an opponent's lands make: two of your
  // colors on a good day, none on a bad one.
  const reflectsOpponent = /an opponent controls could produce/.test(frontOracle(card));
  const n = reflectsOpponent ? 2 : sourceColors(card, identity).size;
  let merit = 3; // colorless
  if (n >= 2) {
    const tempo = entry === 'untapped' ? 14 : entry === 'conditional' ? 9 : 0;
    merit = 20 + 12 * Math.min(n, 3) + tempo;
  } else if (n === 1) {
    merit = entry === 'tapped' ? 4 : 10;
  }
  if (isChannelLand(card) || isMdfcLand(card)) merit += 10;
  return Math.max(0, merit - painPenalty(card));
}

/** Whether a land may be swapped out: a basic, or a plain land that is weak here. */
function cuttable(card: ScryfallCard, merit: number): boolean {
  if (isBasicLandName(card.name)) return true;
  return !isUtilityLand(card) && merit < WEAK_LAND_CEILING;
}

/** Whether a land may come in: plain (or a channel land) and no tempo loss. */
function incomingOk(card: ScryfallCard): boolean {
  if (isUtilityLand(card) && !isChannelLand(card)) return false;
  if (fetchesOnlyBasics(card)) return false;
  return entersAs(card) !== 'tapped';
}

const COLOR_NAME: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
};

interface Candidate {
  card: ScryfallCard;
  score: number;
  colors: Set<string>;
  owned: boolean;
}

/**
 * Propose land upgrades for a deck from a candidate pool of on-color lands.
 *
 * @param deckCards       all cards currently in the deck (lands filtered here)
 * @param identity        the deck's color identity (WUBRG letters)
 * @param candidateLands  resolved on-color lands to consider — the user's owned
 *                        unused lands plus strong duals they may not own yet
 * @param ownedNames      names of lands the user owns (owned → apply-now swap,
 *                        else → "acquire" suggestion; drives the prefer-owned tie-break)
 * @param manaCurve       the deck's mana curve, for pacing-aware shortfall detection
 * @param inclusion       this commander's page play rates (`cardInclusionMap`): a
 *                        premium land never goes out, as with every Coach cut
 *                        (Path of Ancestry out for Reflecting Pool in Lathril
 *                        elves, T171 re-gate)
 */
export function computeLandUpgrades(
  deckCards: readonly ScryfallCard[],
  identity: ReadonlySet<string>,
  candidateLands: readonly ScryfallCard[],
  ownedNames: ReadonlySet<string> = new Set(),
  manaCurve: Record<number, number> = {},
  inclusion: Readonly<Record<string, number>> = {}
): LandUpgradeMove[] {
  const currentLands = deckCards.filter(isLand);
  const nonLands = deckCards.filter((c) => !isLand(c));
  if (currentLands.length === 0) return [];

  // Which colors is the deck short on? Incoming lands that fix a short color earn
  // a stronger "why" and are preferred. Demand vs. sources the deck already has.
  const demand = weightedColorDemand(nonLands);
  const sources = colorSourceCounts(deckCards.filter(isManaSourceType), identity);
  const thresholds = shortfallThresholdsForCurve(manaCurve);
  const shortColors = new Set<string>(
    COLOR_KEYS.filter((c) => identity.has(c) && isColorShort(demand[c], sources[c], thresholds))
  );

  // Candidate pool: on-color lands not in the deck, ranked by merit. Dedupe by
  // name (owned + fetched pools overlap), preferring the owned copy.
  const inDeckNames = new Set(currentLands.map((c) => c.name));
  const byName = new Map<string, Candidate>();
  for (const c of candidateLands) {
    if (!isLand(c) || inDeckNames.has(c.name)) continue;
    if (/\bbasic\b/.test((c.type_line || '').toLowerCase())) continue; // a spare basic isn't an upgrade
    // The card's OWN identity must fit the deck's — a UR shockland still
    // produces usable U in a mono-U deck (so the color clamp passes it) but
    // isn't Commander-legal there. The owned-collection pool arrives unfiltered.
    if (!fitsColorIdentity(c, identity)) continue;
    if (!incomingOk(c)) continue;
    const colors = sourceColors(c, identity);
    if (colors.size === 0) continue;
    const score = landSlotMerit(c, identity);
    const owned = ownedNames.has(c.name);
    const existing = byName.get(c.name);
    if (!existing || (owned && !existing.owned))
      byName.set(c.name, { card: c, score, colors, owned });
  }
  const candidates = [...byName.values()].sort((a, b) => b.score - a.score);
  if (candidates.length === 0) return [];

  // Basics the deck's own fetchers (Cultivate, Evolving Wilds) need stay put.
  let spareBasics =
    currentLands.filter((c) => isBasicLandName(c.name)).length -
    BASICS_PER_FETCHER * countBasicFetchers([...deckCards]);

  // Weakest current lands first — these are the cut targets.
  const cutTargets = currentLands
    .map((c) => ({ card: c, score: landSlotMerit(c, identity), colors: sourceColors(c, identity) }))
    .filter((l) => cuttable(l.card, l.score))
    .filter(
      (l) =>
        isBasicLandName(l.card.name) ||
        !isPremiumCard(l.card, { inclusion: inclusion[l.card.name] })
    )
    .sort((a, b) => a.score - b.score);

  const moves: LandUpgradeMove[] = [];
  const usedIn = new Set<string>();
  const usedOut = new Set<string>();

  for (const out of cutTargets) {
    if (moves.length >= MAX_UPGRADES) break;
    if (usedOut.has(out.card.name)) continue;
    const basic = isBasicLandName(out.card.name);
    if (basic && spareBasics <= 0) continue;

    // Best land that (a) isn't spoken for, (b) covers every color the cut land
    // made (no color regression), (c) beats it by the margin. Prefer one that
    // fixes a short color, then an owned copy over an unowned one of comparable
    // merit (via OWNED_PREFERENCE), then raw merit.
    const pick = candidates
      .filter((cand) => !usedIn.has(cand.card.name))
      .filter((cand) => [...out.colors].every((c) => cand.colors.has(c)))
      .filter((cand) => cand.score >= out.score + UPGRADE_MARGIN)
      .sort((a, b) => {
        const aFix = [...a.colors].some((c) => shortColors.has(c)) ? 1 : 0;
        const bFix = [...b.colors].some((c) => shortColors.has(c)) ? 1 : 0;
        if (aFix !== bFix) return bFix - aFix;
        const aEff = a.score + (a.owned ? OWNED_PREFERENCE : 0);
        const bEff = b.score + (b.owned ? OWNED_PREFERENCE : 0);
        return bEff - aEff;
      })[0];
    if (!pick) continue;

    const fixesShort = [...pick.colors].filter((c) => shortColors.has(c));
    const addsColors = [...pick.colors].filter((c) => !out.colors.has(c));
    moves.push({
      outName: out.card.name,
      outCard: out.card,
      inName: pick.card.name,
      inCard: pick.card,
      owned: pick.owned,
      outScore: out.score,
      inScore: pick.score,
      fixesShortColors: fixesShort,
      addsColors,
      reason: buildReason(out, pick, fixesShort),
    });
    usedIn.add(pick.card.name);
    usedOut.add(out.card.name);
    if (basic) spareBasics--;
  }

  return moves;
}

// Owned/unowned status already shows as its own "Owned" chip on the row
// (B6-09), so the reason itself never repeats it — it leads straight with the
// fixing fact, and only the unowned case gets a lead sentence ("Worth picking
// up.") since that framing isn't shown anywhere else on the row.
function buildReason(
  out: { card: ScryfallCard; colors: Set<string> },
  pick: Candidate,
  fixesShort: string[]
): string {
  const lead = pick.owned ? '' : 'Not owned. ';
  if (fixesShort.length > 0) {
    const names = fixesShort.map((c) => COLOR_NAME[c] ?? c).join(' and ');
    return `${lead}Adds ${names} fixing you're short on, over ${out.card.name}.`;
  }
  const extra = [...pick.colors].filter((c) => !out.colors.has(c));
  if (extra.length > 0) {
    const names = extra.map((c) => COLOR_NAME[c] ?? c).join(' and ');
    return `${lead}Keeps your colors and adds ${names}, over ${out.card.name}.`;
  }
  return `${lead}Better fixing or upside than ${out.card.name}.`;
}
