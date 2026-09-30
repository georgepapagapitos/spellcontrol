/**
 * How the objective READS a card's facts: the card-facts snapshot, checked
 * against the card's own oracle text wherever a fact is a claim a swap reason
 * would repeat. A fact the text does not bear out is dropped, never
 * invented, so every reason the objective states is one the card's text
 * supports.
 *
 * - A transforming card's back face is not the card you cast (E78): Elesh
 *   Norn // The Argent Etchings is a creature, not a board wipe.
 * - Protection is protection of SOMETHING ELSE: Kaito Shizuki phasing
 *   himself out on the turn he enters protects Kaito, not the deck.
 * - A token made for another player feeds nothing here: Rapid
 *   Hybridization's Frog Lizard goes to the destroyed creature's controller.
 * - A payoff needs its resource in the text: Selfless Safewright's convoke
 *   is not a token payoff, and Interplanar Beacon, which triggers on casting
 *   planeswalker spells, is not paid by proliferate.
 *
 * Checks, not a parser: each only ever REMOVES a fact the extractor produced.
 * The first optimizer gate (2026-09-29) found eight stated reasons the cards
 * did not support; these are the readings behind them.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import type { CardFacts, Resource } from '@/deck-builder/services/cardFacts';
import { buildCommanderProfile, getCombinedOracleText } from '../commanderProfile';

/** The card's rules text, reminder text stripped, its own name read as "~". */
export function rulesText(card: ScryfallCard): string {
  return getCombinedOracleText(card);
}

const PROTECTION_WORDS =
  /\b(hexproof|shroud|indestructible|protection from|phases? out|can't be the target|can't be countered|ward)\b/i;
/**
 * What a protection clause is FOR: another permanent, the player, a spell.
 * "Equipped creature", "creatures you control", "target creature", "you gain
 * protection", "all permanents you control phase out", "spells you control
 * can't be countered". A clause about the card itself ("~ phases out",
 * "this creature has hexproof", a bare keyword) protects only that card.
 */
const PROTECTS_OTHER =
  /\b(equipped|enchanted|target|other|another|each|all|any number of)\b[^.]*?\b(creatures?|permanents?|commanders?|spells?|player)\b|\b(creatures?|permanents?|spells?) you control\b|\byou (gain|have|get)\b[^.]*?\b(protection|hexproof|shroud)\b|\byour commanders?\b/i;

function protectionSentences(card: ScryfallCard): string[] {
  return rulesText(card)
    .split(/(?<=[.\n])\s*/)
    .filter((sentence) => PROTECTION_WORDS.test(sentence));
}

/** True when the card's protection text protects something other than itself. */
export function protectsOthers(card: ScryfallCard): boolean {
  return protectionSentences(card).some((sentence) => PROTECTS_OTHER.test(sentence));
}

/**
 * Protection words that only ever protect the card itself (Kaito Shizuki).
 * A protection fact with NO such words is left alone: a redirect (Deflecting
 * Swat) or a counterspell protects the commander without them.
 */
export function protectsOnlyItself(card: ScryfallCard): boolean {
  const sentences = protectionSentences(card);
  return sentences.length > 0 && !sentences.some((sentence) => PROTECTS_OTHER.test(sentence));
}

/**
 * What keeps a permanent on the battlefield, the generator's E532 survival
 * rule: a counterspell that protects a SPELL does not keep a commander alive.
 */
const KEEPS_PERMANENT = /\b(hexproof|shroud|indestructible|protection from)\b|\bphases? out\b/i;

/** A protection piece that keeps the commander on the battlefield (Lightning Greaves, Teferi's Protection). */
export function isSurvivalPiece(card: ScryfallCard, facts: CardFacts): boolean {
  if (!facts.roles.some((r) => r.role === 'protection')) return false;
  return KEEPS_PERMANENT.test(rulesText(card)) && protectsOthers(card);
}

/**
 * A value engine that repeats while the commander stays on the battlefield:
 * a trigger or an activated ability (the generator's E532 rule).
 */
const REPEATING_ENGINE = /\bwhenever\b|\bat the beginning of\b|\{[^}]+\}[^.:]*:/;
const mustSurviveCache = new Map<string, boolean>();

/**
 * The commander has to survive (a repeating engine) or connect (attack
 * triggers, voltron, extra combats), so protection that keeps it on the
 * battlefield is worth more. The same rule the generator's E532 pick-time
 * promotion uses (commander profile keywords plus a repeating ability).
 */
export function commanderMustSurvive(commanders: readonly ScryfallCard[]): boolean {
  if (commanders.length === 0) return false;
  const key = commanders.map((c) => c.name).join('|');
  let v = mustSurviveCache.get(key);
  if (v === undefined) {
    const profile = buildCommanderProfile(commanders[0], commanders[1] ?? null);
    v =
      profile.abilities.some(
        (a) =>
          a.keyword === 'attack-trigger' || a.keyword === 'voltron' || a.keyword === 'extra-combat'
      ) || commanders.some((c) => REPEATING_ENGINE.test(rulesText(c)));
    mustSurviveCache.set(key, v);
  }
  return v;
}

/** "Its controller creates", "that player creates", "target opponent creates": a token for someone else. */
const TOKEN_FOR_OTHERS =
  /\b(?:its|that (?:creature|permanent|player)'s|their) controllers? creates?\b|\b(?:target|each) opponents? creates?\b|\bthat player creates?\b/i;
const TOKEN_FOR_YOU = /\byou create\b|\bcreates? [^.]*\btokens?\b[^.]*\bunder your control\b/i;

/** Tokens this card makes land only under another player's control. */
export function tokensGoToOthers(card: ScryfallCard): boolean {
  const text = rulesText(card);
  return TOKEN_FOR_OTHERS.test(text) && !TOKEN_FOR_YOU.test(text);
}

/**
 * The words a PAYOFF of each resource has to carry. A resource without an
 * entry is not checked (its payoffs are read as the extractor gave them).
 */
const PAYOFF_EVIDENCE: Partial<Record<Resource, RegExp>> = {
  // Tokens by name, or creatures entering / counted ("whenever a creature you
  // control enters": Impact Tremors). Not a creature-type choice or convoke.
  'creature-token':
    /\btokens?\b|\bcreatures? you control\b|\bwhenever (?:a|another|one or more) (?:\w+ )?creatures?\b/i,
  'plus1-counter': /\+1\/\+1 counters?/i,
  loyalty: /\bloyalty\b|\bplaneswalkers? you control\b/i,
  death:
    /\bdies\b|\bdie\b|\bdied\b|put into (?:a|your|an opponent's) graveyard from the battlefield|\bsacrifices?\b/i,
  landfall: /\blands?\b/i,
  graveyard: /\bgraveyards?\b/i,
  lifegain: /\bgains? (?:\w+ )?life\b|\blife you gain\b|\blifelink\b/i,
  poison: /\bpoison\b|\btoxic\b|\binfect\b|\bcorrupted\b|\bproliferate\b/i,
};

/** The transforming layouts: the back face is reached only by transforming. */
const TRANSFORMS = new Set(['transform', 'meld']);

/** Drop the facts the card's text does not bear out. */
export function readFacts(card: ScryfallCard, facts: CardFacts): CardFacts {
  const text = rulesText(card);
  const transforms = TRANSFORMS.has(card.layout ?? '');
  const reachable = <T extends { face?: number; limits?: readonly string[] }>(f: T) =>
    !(transforms && (f.face ?? 0) >= 1) && !(f.limits ?? []).includes('transform');
  const interaction = facts.interaction.filter(reachable);
  const selfOnly = protectsOnlyItself(card);
  const roles = facts.roles.filter((r) => reachable(r) && (r.role !== 'protection' || !selfOnly));
  const producesOthers = tokensGoToOthers(card);
  const produces = facts.produces.filter(
    (p) => reachable(p) && !(producesOthers && p.r === 'creature-token')
  );
  const payoffs = facts.payoffs.filter((p) => {
    if (!reachable(p)) return false;
    const evidence = PAYOFF_EVIDENCE[p.r];
    return !evidence || evidence.test(text);
  });
  if (
    interaction.length === facts.interaction.length &&
    roles.length === facts.roles.length &&
    produces.length === facts.produces.length &&
    payoffs.length === facts.payoffs.length
  ) {
    return facts;
  }
  return { ...facts, interaction, roles, produces, payoffs };
}
