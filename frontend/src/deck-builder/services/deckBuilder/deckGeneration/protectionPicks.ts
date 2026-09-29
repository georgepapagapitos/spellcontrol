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
 *  the page has to show players protect this commander with it. */
// ponytail: flat floor. A per-page relative bar (the page's own top piece) if
// thin pages promote pieces nobody plays there.
export const PROTECTION_PICK_MIN_INCLUSION = 20;

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
 * The survival pieces a type pass tries first: the highest-inclusion ones in
 * `pool` at PROTECTION_PICK_MIN_INCLUSION or more, as many as the deck still
 * has room for under PROTECTION_PICK_CAP (counting pieces already seated,
 * staples included).
 */
export function protectionAdmitsFor(
  pool: readonly EDHRECCard[],
  cardMap: ReadonlyMap<string, ScryfallCard>,
  seated: readonly ScryfallCard[]
): Set<string> {
  const room = PROTECTION_PICK_CAP - seated.filter(isSurvivalPiece).length;
  if (room <= 0) return new Set();
  const seatedNames = new Set(seated.map((c) => c.name));
  return new Set(
    pool
      .filter((c) => {
        const card = cardMap.get(c.name);
        if (!card || seatedNames.has(card.name)) return false;
        return c.inclusion >= PROTECTION_PICK_MIN_INCLUSION && isSurvivalPiece(card);
      })
      .sort((a, b) => b.inclusion - a.inclusion)
      .slice(0, room)
      .map((c) => c.name)
  );
}

/** The TypePassContext hook: undefined (no promotion) unless the commander must survive. */
export function makeProtectionAdmits(
  mustSurvive: boolean,
  cardMap: ReadonlyMap<string, ScryfallCard>,
  seated: () => readonly ScryfallCard[]
): ((pool: EDHRECCard[]) => ReadonlySet<string>) | undefined {
  return mustSurvive ? (pool) => protectionAdmitsFor(pool, cardMap, seated()) : undefined;
}
