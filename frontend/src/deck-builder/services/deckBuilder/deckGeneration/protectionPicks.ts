// E532: pick-time value for the pieces that keep a commander on the
// battlefield (Lightning Greaves, Swiftfoot Boots, Heroic Intervention,
// Teferi's Protection) when the commander has to survive or connect.
//
// These cards carry no role, so no role-deficit boost ever lifts them, and at
// 30-50% EDHREC inclusion they sorted behind boosted filler in every type
// pass. Once seated, every eviction phase already protects them
// (isProtectionPiece in Smart Trim, the surplus rebalance, bracket/budget
// convergence, coherence repair), so the loss was only ever at pick time: they
// reached decks through later surplus conversions, and any change to role
// targets or pick order dropped them (E509, E510 and E511 gates: Meren,
// Krenko, Lathril, Talrand).
//
// The value is a place in the type pass's first tier (cardPicking.ts's
// admitFirst), not a score: bounded by construction to PROTECTION_PICK_CAP
// pieces a deck, and only for cards this commander's own page plays.
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import { isProtectionPiece } from '@/deck-builder/services/tagger/client';
import { getCombinedOracleText, type CommanderProfile } from '../commanderProfile';

/** A deck wants one or two of these, not a pile. */
export const PROTECTION_PICK_CAP = 2;

/** EDHREC inclusion (%) a piece needs on this commander's page to be promoted:
 *  the page has to show players protect this commander with it. 15 keeps the
 *  18-20% pieces that had reached Meren and Yuriko decks through conversions. */
// ponytail: flat floor. A per-page relative bar (the page's own top piece) if
// thin pages promote pieces nobody plays there.
export const PROTECTION_PICK_MIN_INCLUSION = 15;

// A value engine that repeats while the commander stays on the battlefield: a
// trigger ("whenever", "at the beginning of") or an activated ability
// ("{T}: ...", "{2}{B}, Sacrifice a creature: ..."). getCombinedOracleText
// strips reminder text, so a keyword's reminder can't satisfy this.
const REPEATING_ENGINE = /\bwhenever\b|\bat the beginning of\b|\{[^}]+\}[^.:]*:/;

// What keeps a permanent on the battlefield. isProtectionPiece also covers
// free counterspells, redirects and "can't be countered" (Fierce Guardianship,
// Deflecting Swat, Allosaurus Shepherd), which protect spells, not a
// commander: a live Lathril run spent a slot on Allosaurus Shepherd that way.
const KEEPS_PERMANENT = /\b(hexproof|shroud|indestructible|protection from)\b|\bphases? out\b/;

/** A protection piece that keeps the commander on the battlefield. */
export function isSurvivalPiece(card: ScryfallCard): boolean {
  return isProtectionPiece(card) && KEEPS_PERMANENT.test(getCombinedOracleText(card));
}

/**
 * True when the commander has to survive (a repeating engine: experience
 * counters, cast/death triggers, tap abilities) or connect (attack triggers,
 * voltron, extra combats). A commander whose value is one enters or cast
 * trigger (Atraxa, Grand Unifier) doesn't qualify.
 */
export function commanderMustSurvive(
  commanders: readonly ScryfallCard[],
  profile: Pick<CommanderProfile, 'abilities'>
): boolean {
  if (
    profile.abilities.some(
      (a) =>
        a.keyword === 'attack-trigger' || a.keyword === 'voltron' || a.keyword === 'extra-combat'
    )
  ) {
    return true;
  }
  return commanders.some((c) => REPEATING_ENGINE.test(getCombinedOracleText(c)));
}

/**
 * The survival pieces worth promoting: the PROTECTION_PICK_CAP highest-
 * inclusion ones on the whole page (every type pool), at
 * PROTECTION_PICK_MIN_INCLUSION or more. Ranked page-wide, not per pass: the
 * creature pass runs first, so a per-pass pick spent Lathril's second slot on
 * Selfless Safewright (30.5%) before Swiftfoot Boots (36%) was ever seen.
 */
export function rankSurvivalPieces(
  candidates: readonly EDHRECCard[],
  cardMap: ReadonlyMap<string, ScryfallCard>
): string[] {
  const best = new Map<string, number>();
  for (const c of candidates) {
    const card = cardMap.get(c.name);
    if (!card || c.inclusion < PROTECTION_PICK_MIN_INCLUSION || !isSurvivalPiece(card)) continue;
    best.set(c.name, Math.max(best.get(c.name) ?? 0, c.inclusion));
  }
  return [...best]
    .sort((a, b) => b[1] - a[1])
    .slice(0, PROTECTION_PICK_CAP)
    .map(([name]) => name);
}

/**
 * The TypePassContext hook: the ranked pieces not yet seated, while the deck
 * holds fewer than PROTECTION_PICK_CAP survival pieces (staples and organic
 * picks included). Undefined (no promotion) unless the commander must survive.
 * A ranked piece a hard gate rejects (price, rarity) just leaves its slot to
 * the ordinary picks.
 */
export function makeProtectionAdmits(
  mustSurvive: boolean,
  candidates: readonly EDHRECCard[],
  cardMap: ReadonlyMap<string, ScryfallCard>,
  seated: () => readonly ScryfallCard[]
): (() => ReadonlySet<string>) | undefined {
  if (!mustSurvive) return undefined;
  const ranked = rankSurvivalPieces(candidates, cardMap);
  return () => {
    const deck = seated();
    if (deck.filter(isSurvivalPiece).length >= PROTECTION_PICK_CAP) return new Set();
    const seatedNames = new Set(deck.map((c) => c.name));
    return new Set(ranked.filter((name) => !seatedNames.has(name)));
  };
}
