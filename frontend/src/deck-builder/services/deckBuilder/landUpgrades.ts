/**
 * Land-upgrade engine — the per-deck "Re-analyze lands" tool.
 *
 * Given a deck's current lands and the lands the user OWNS but isn't running,
 * it proposes safe, explainable swaps: cut a weak land (usually a basic or an
 * off-color/dead land), add a stronger owned land, scored by the popularity-blind
 * `landPowerScore` (so a strong *new* land the user owns surfaces on merit even
 * though EDHREC has never heard of it). It's the collection-native counterpart to
 * the generation-time fix — nothing here silently mutates a deck; every move is a
 * `Change` the user approves.
 *
 * Safety: a swap is only proposed when the incoming land covers every color the
 * outgoing land produced (no color regression), scores meaningfully higher, and
 * the outgoing land is genuinely weak. Each land is used at most once per side.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { landPowerScore } from './landPower';
import { producedManaColors, isManaSourceType } from '@/lib/mana-sources';
import { weightedColorDemand, colorSourceCounts, fetchableBasicColors } from './manabaseMath';
import { isColorShort, shortfallThresholdsForCurve } from './colorShortfall';

/** Only cut lands weaker than this — never disturb a strong manabase piece. */
const WEAK_LAND_CEILING = 55;
/** Require this much score gain, so we don't churn near-equal lands. */
const UPGRADE_MARGIN = 12;
/** Cap proposals so the lane stays scannable. */
const MAX_UPGRADES = 8;

export interface LandUpgradeMove {
  /** Current deck land being cut (by name — the page resolves it to a slot). */
  outName: string;
  outCard: ScryfallCard;
  /** Owned land being added. */
  inName: string;
  inCard: ScryfallCard;
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

/** Identity-clamped colors a land supplies (production ∪ what a fetch finds). */
function landColors(card: ScryfallCard, identity: ReadonlySet<string>): Set<string> {
  const out = new Set(producedManaColors(card, identity).filter((c) => identity.has(c)));
  for (const c of fetchableBasicColors(card, identity)) out.add(c);
  return out;
}

const COLOR_NAME: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
};

/**
 * Propose land upgrades for a deck from the user's owned, unused lands.
 *
 * @param deckCards    all cards currently in the deck (lands are filtered out here)
 * @param identity     the deck's color identity (WUBRG letters)
 * @param ownedLands   resolved lands the user owns that are NOT already in the deck
 * @param manaCurve    the deck's mana curve, for pacing-aware shortfall detection
 */
export function computeLandUpgrades(
  deckCards: readonly ScryfallCard[],
  identity: ReadonlySet<string>,
  ownedLands: readonly ScryfallCard[],
  manaCurve: Record<number, number> = {}
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

  // Candidate pool: owned lands not in the deck, on-identity, ranked by merit.
  const inDeckNames = new Set(currentLands.map((c) => c.name));
  const candidates = ownedLands
    .filter((c) => isLand(c) && !inDeckNames.has(c.name))
    .filter((c) => !/\bbasic\b/.test((c.type_line || '').toLowerCase())) // a spare basic isn't an upgrade
    .filter((c) => landColors(c, identity).size > 0 || landPowerScore(c, identity) > 0)
    .map((c) => ({ card: c, score: landPowerScore(c, identity), colors: landColors(c, identity) }))
    .sort((a, b) => b.score - a.score);
  if (candidates.length === 0) return [];

  // Weakest current lands first — these are the cut targets.
  const cutTargets = currentLands
    .map((c) => ({ card: c, score: landPowerScore(c, identity), colors: landColors(c, identity) }))
    .filter((l) => l.score < WEAK_LAND_CEILING)
    .sort((a, b) => a.score - b.score);

  const moves: LandUpgradeMove[] = [];
  const usedIn = new Set<string>();
  const usedOut = new Set<string>();

  for (const out of cutTargets) {
    if (moves.length >= MAX_UPGRADES) break;
    if (usedOut.has(out.card.name)) continue;

    // Best owned land that (a) isn't spoken for, (b) covers every color the cut
    // land made (no color regression), (c) beats it by the margin. Prefer one
    // that also fixes a short color.
    const pick = candidates
      .filter((cand) => !usedIn.has(cand.card.name))
      .filter((cand) => [...out.colors].every((c) => cand.colors.has(c)))
      .filter((cand) => cand.score >= out.score + UPGRADE_MARGIN)
      .sort((a, b) => {
        const aFix = [...a.colors].some((c) => shortColors.has(c)) ? 1 : 0;
        const bFix = [...b.colors].some((c) => shortColors.has(c)) ? 1 : 0;
        if (aFix !== bFix) return bFix - aFix;
        return b.score - a.score;
      })[0];
    if (!pick) continue;

    const fixesShort = [...pick.colors].filter((c) => shortColors.has(c));
    const addsColors = [...pick.colors].filter((c) => !out.colors.has(c));
    moves.push({
      outName: out.card.name,
      outCard: out.card,
      inName: pick.card.name,
      inCard: pick.card,
      outScore: out.score,
      inScore: pick.score,
      fixesShortColors: fixesShort,
      addsColors,
      reason: buildReason(out, pick, fixesShort),
    });
    usedIn.add(pick.card.name);
    usedOut.add(out.card.name);
  }

  return moves;
}

function buildReason(
  out: { card: ScryfallCard; colors: Set<string> },
  pick: { card: ScryfallCard; colors: Set<string> },
  fixesShort: string[]
): string {
  if (fixesShort.length > 0) {
    const names = fixesShort.map((c) => COLOR_NAME[c] ?? c).join(' and ');
    return `Stronger land you own — adds ${names} fixing you're short on, over ${out.card.name}.`;
  }
  const extra = [...pick.colors].filter((c) => !out.colors.has(c));
  if (extra.length > 0) {
    const names = extra.map((c) => COLOR_NAME[c] ?? c).join(' and ');
    return `A better land from your collection — keeps your colors and adds ${names}, over ${out.card.name}.`;
  }
  return `A stronger land you already own — better fixing or upside than ${out.card.name}.`;
}
