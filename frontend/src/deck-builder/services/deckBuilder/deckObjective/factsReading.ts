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

/**
 * A protection piece that keeps the commander on the battlefield (Lightning
 * Greaves, Teferi's Protection), and can reach THIS commander: Skrelv,
 * Defector Mite protects only a creature "with toxic, infect, or poisonous",
 * and a "target Ninja creature" clause only a Ninja.
 */
export function isSurvivalPiece(
  card: ScryfallCard,
  facts: CardFacts,
  commanders: readonly ScryfallCard[] = []
): boolean {
  if (!facts.roles.some((r) => r.role === 'protection')) return false;
  if (!KEEPS_PERMANENT.test(rulesText(card)) || !protectsOthers(card)) return false;
  return commanders.length === 0 || commanders.some((c) => canProtect(card, c));
}

/** Whether a protection clause of `card` can reach `commander` (no restriction it fails). */
export function canProtect(card: ScryfallCard, commander: ScryfallCard): boolean {
  const commanderText = rulesText(commander).toLowerCase();
  const keywords = (commander.keywords ?? []).map((k) => k.toLowerCase());
  const type = (commander.type_line ?? '').toLowerCase();
  return protectionSentences(card)
    .filter((s) => PROTECTS_OTHER.test(s) && KEEPS_PERMANENT.test(s))
    .some((s) => {
      const lower = s.toLowerCase();
      const withWords =
        /\bcreatures? you control with ([a-z ,]+?)(?= gains?\b| has\b| have\b|[.:]|$)/.exec(lower);
      if (withWords) {
        const needs = withWords[1]
          .split(/,|\bor\b/)
          .map((w) => w.trim())
          .filter(Boolean);
        if (!needs.some((w) => keywords.includes(w) || commanderText.includes(w))) return false;
      }
      // "Target Merfolk you control", "target Spirit", "another target Ally":
      // a creature type the commander must have.
      const subtype = /\btarget ([a-z]+)\b/.exec(lower.replace(/\banother target\b/, 'target'));
      if (subtype && !NOT_A_SUBTYPE.has(subtype[1]) && !type.includes(subtype[1])) return false;
      return true;
    });
}

/** Words that sit between "target" and "creature" without naming a creature type. */
const NOT_A_SUBTYPE = new Set([
  'creature',
  'creatures',
  'permanent',
  'permanents',
  'player',
  'players',
  'spell',
  'nonland',
  'noncreature',
  'another',
  'other',
  'legendary',
  'attacking',
  'blocking',
  'tapped',
  'untapped',
  'nontoken',
  'token',
  'artifact',
  'enchantment',
  'nonartifact',
  'white',
  'blue',
  'black',
  'red',
  'green',
  'colorless',
]);

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
  // control enters": Impact Tremors; "for each creature you control":
  // Craterhoof). Not a creature-type choice or convoke, and not an effect that
  // merely reaches every creature: Leyline of Abundance's "a +1/+1 counter on
  // each creature you control" pays nothing off for tokens (E513 round 2).
  'creature-token':
    /\btokens?\b|\bfor each creature you control\b|\bnumber of creatures you control\b|\bwhenever (?:a|another|one or more) (?:\w+ )?creatures?\b/i,
  'plus1-counter': /\+1\/\+1 counters?/i,
  loyalty: /\bloyalty\b|\bplaneswalkers? you control\b/i,
  landfall: /\blands?\b/i,
  graveyard: /\bgraveyards?\b/i,
  lifegain: /\bgains? (?:\w+ )?life\b|\blife you gain\b|\blifelink\b/i,
  poison: /\bpoison\b|\btoxic\b|\binfect\b|\bcorrupted\b|\bproliferate\b/i,
  // Captain Lannery Storm makes Treasure; nothing about it rewards spells.
  'instant-sorcery': /\binstants?\b|\bsorcery\b|\bsorceries\b|\bnoncreature spells?\b/i,
  // Other cards cycling, not its own ("When you cycle ~": Deem Worthy).
  cycling: /\bwhenever (?:you|a player) cycles? (?:or discards? )?(?:a|another|one or more)\b/i,
};

/**
 * The words a PRODUCER of each resource has to carry. Discard feeds a
 * discard payoff only when the card makes YOU discard (Discovery // Dispersal
 * makes opponents discard).
 */
const PRODUCER_EVIDENCE: Partial<Record<Resource, RegExp>> = {
  discard:
    /(?:^|[.\n:,] ?|\bthen |\byou (?:may )?)discards? (?:a|an|one|two|three|x|that|your|up to|any number of)\b|\beach player discards\b|\bdiscard (?:a|an|one|two|three|x) cards?\b/i,
};

/** A mass effect that needs a board the deck won't have (Glyph of Reincarnation's Wall). */
const NARROW_MASS =
  /\bblocked by target wall\b|\bthat were blocked by\b|\bthat blocked (?:target|this)\b/i;

/**
 * An ability that needs an opponent to discard is not an engine you can count
 * on: Waste Not "draws on every trigger" and "adds {B}{B}" only when an
 * opponent discards, which most decks never make happen (the second gate's
 * Waste Not took Mana Vault's ramp slot as a draw engine).
 */
function needsOpponentDiscard(facts: CardFacts, ability: number): boolean {
  const trigger = facts.abilities[ability]?.trigger;
  return trigger?.event === 'discard' && trigger.who === 'opp';
}

/** The transforming layouts: the back face is reached only by transforming. */
const TRANSFORMS = new Set(['transform', 'meld']);

/** Drop the facts the card's text does not bear out. */
export function readFacts(card: ScryfallCard, facts: CardFacts): CardFacts {
  const text = rulesText(card);
  const transforms = TRANSFORMS.has(card.layout ?? '');
  const reachable = <T extends { face?: number; limits?: readonly string[] }>(f: T) =>
    !(transforms && (f.face ?? 0) >= 1) && !(f.limits ?? []).includes('transform');
  const narrowMass = NARROW_MASS.test(text);
  const interaction = facts.interaction.filter(
    (f) => reachable(f) && !(narrowMass && f.scope === 'mass')
  );
  const selfOnly = protectsOnlyItself(card);
  const roles = facts.roles.filter(
    (r) =>
      reachable(r) &&
      !((r.role === 'ramp' || r.role === 'cardDraw') && needsOpponentDiscard(facts, r.ability)) &&
      (r.role !== 'protection' || !selfOnly) &&
      !(narrowMass && r.role === 'boardwipe')
  );
  const producesOthers = tokensGoToOthers(card);
  const produces = facts.produces.filter((p) => {
    if (!reachable(p) || (producesOthers && p.r === 'creature-token')) return false;
    const evidence = PRODUCER_EVIDENCE[p.r];
    return !evidence || evidence.test(text);
  });
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
