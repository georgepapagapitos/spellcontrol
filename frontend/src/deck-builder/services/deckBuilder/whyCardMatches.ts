/**
 * "Why it fits your commander": the pills on a deck row and in the card
 * detail. Given a commander's profile (commanderProfile.ts), says which of its
 * abilities a candidate card feeds. Also read as a yes/no "is this a plan
 * card" signal by incidentalRole.ts and the Coach's cut protections.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import {
  NOT_COUNTERSPELL,
  cap,
  detectTribes,
  frontTypeLine,
  getCombinedOracleText,
  type CommanderKeyword,
  type CommanderProfile,
} from './commanderProfile';

// A pill claims a real interaction: the card does something the commander's
// plan uses or pays off. Being a card type is never enough on its own (Sol
// Ring is not "Cares about artifacts"), and the subject matters: "its
// controller creates a token" feeds the opponent, "sacrifice this land" is a
// cost, not an outlet. Each rule is scored against a two-rater golden set of
// real cards (whyCardMatches.golden.test.ts).

/**
 * The card's text with its self-references folded into "~", so "sacrifice
 * this artifact" and "this enchantment deals 1 damage" read as the card
 * talking about itself, the same way the name already does.
 */
function feederText(card: ScryfallCard): string {
  return getCombinedOracleText(card).replace(
    /\bthis (?:artifact|creature|land|enchantment|permanent|aura|equipment|vehicle|planeswalker|saga|card|spell|token|class|case|battle|siege|room)\b/g,
    '~'
  );
}

const isLand = (card: ScryfallCard) => /\bland\b/i.test(card.type_line ?? '');
const N = String.raw`(?:a|an|another|one|two|three|four|five|six|seven|ten|x|that many|any number of|up to (?:one|two|three|x)|\d+)`;

const EVASION = String.raw`(?:flying|trample|menace|shadow|fear|intimidate|horsemanship|skulk|can't be blocked)`;
const PROTECTION = String.raw`(?:hexproof|shroud|indestructible|protection from|ward)`;
// Who receives a grant: your creatures, a target creature, the equipped or
// enchanted one. Never "~" (the card itself) or "you" (the player).
const YOUR_CREATURES = String.raw`(?:(?:other |each |all )?(?:[a-z]+ )?creatures you control|those creatures|(?:another )?target (?:[a-z]+ )?(?:creature|permanent you control)(?: you control)?|(?:all |other )?permanents you control|commanders? you control|equipped creature|enchanted creature)`;
const GRANTS = (what: string) =>
  new RegExp(
    String.raw`\b${YOUR_CREATURES}\b[^.]*?\b(?:gains?|have|has|get [^.]*? and (?:gain|have)|gets [^.]*? and (?:gains|has))\b[^.]*?\b${what}`
  );
const GRANTS_EVASION = GRANTS(EVASION);
const GRANTS_PROTECTION = GRANTS(PROTECTION);
// "Put a counter on target creature you control. It gains hexproof" (Snakeskin Veil).
const THEN_IT_GAINS = new RegExp(
  String.raw`\btarget (?:[a-z]+ )?(?:creature|permanent)(?: you control)?\b[^.]*\. (?:it|that creature) gains\b[^.]*?\b(?:${PROTECTION}|${EVASION})`
);
const UNBLOCKABLE =
  /\b(?:target|equipped|enchanted|that) creature\b[^.]*?\bcan't be blocked\b|\bcan't block creatures you control\b|\bcreatures you control can't be blocked\b|\bcreatures? (?:your opponents control )?can't block (?:this turn)?/;
// Its own attack trigger, the thing an attack-trigger commander (Isshin)
// multiplies. "Whenever an opponent attacks" is the other side's attack.
const ATTACK_PAYOFF =
  /\bwhenever (?:~|(?:equipped creature|enchanted creature|(?:a|one or more|another) (?:[a-z]+ )?creatures? you control)\b)[^.]*?\battacks?\b(?! or blocks, remove)|\bwhenever you attack\b|\b(?:myriad|exalted|battle cry|annihilator|melee|dethrone|mentor|training|firebending|mobilize)\b|\battacking causes\b/;
const PHASES_OUT =
  /\b(?:creatures|permanents) you control phase out\b|\b(?:up to one )?target (?:creature|permanent)(?: you control)? phases out\b/;

// Blink: your permanent leaves and comes back. Generic bounce of "target
// creature" is removal, not a re-trigger.
const BLINK =
  /\bexile (?:up to (?:one|two) |another |any number of )?(?:other )?target (?:[a-z]+ )?(?:creature|permanent|artifact|enchantment)s? you (?:control|own)\b[^.]*?\breturn\b|\bexile [^.]*?\btarget [^.]*?\byou (?:control|own)\b[^.]*?\breturn (?:it|them|that card|those cards)\b|\bexile [^.]*?you control[^.]*?\breturn (?:it|them|that card|those cards) to the battlefield\b|\breturn (?:another )?target (?:[a-z]+ )?(?:creature|permanent)s? you control to (?:its|their) owner's hand\b/;
const ETB_DOUBLER = /\btriggers? an additional time\b/;

// Tokens YOU create: imperative "create", never "its controller creates".
const YOU_CREATE_TOKEN = /\bcreate (?!or )[^.]*?\btokens?\b|\bamass\b|\bpopulate\b|\binvestigate\b/;
const YOU_CREATE_CREATURE_TOKEN =
  /\bcreate (?!or )[^.]*?\bcreature tokens?\b|\bcreate a token that's a copy of [^.]*?\bcreature\b|\bamass\b|\bpopulate\b/;
const TOKEN_DOUBLER = /\btwice that many\b[^.]*?\btokens?\b|\btokens?\b[^.]*?\btwice that many\b/;
const ANTHEM = /\bcreatures you control\b[^.]*?\bgets? \+|\bdouble the power\b/;
const SAC_OUTLET = new RegExp(
  String.raw`(?<!or )\bsacrifice ${N} (?:other )?(?:nontoken |nonland |untapped )?(?:creatures?|permanents?|artifacts?|tokens?|lands?|nonland permanents?|artifact or creature|creature or artifact)\b(?! or [a-z]+ card)`
);
const CREATURE_SAC_OUTLET = new RegExp(
  String.raw`(?<!or )\bsacrifice ${N} (?:other )?(?:nontoken )?(?:creatures?|permanents?|nonland permanents?|artifact or creature|creature or artifact)\b`
);
const DEATH_PAYOFF =
  /\bwhenever (?:~ or )?(?:a|another|one or more)\b[^.]*?\b(?:creatures?|permanents?|tokens?)\b[^.]*?\b(?:dies|die|is put into a graveyard from the battlefield)\b|\bwhenever you (?:create or )?sacrifice\b|\bwhenever (?:equipped|enchanted) creature dies\b/;
const OWN_DEATH_VALUE = /\bwhen ~ dies\b/;

const MEANINGLESS_COUNTER = /^(?:void|luck|memory|indestructible|fate|doom|ice)$/;
const COUNTER_DOUBLER =
  /\btwice that many\b[^.]*?\bcounters?\b|\bcounters?\b[^.]*?\btwice that many\b|\bthat many plus one\b|\bdouble the number of\b[^.]*?\bcounters?\b|\briot\b|\bamass\b/;
function placesMeaningfulCounters(text: string): boolean {
  if (/\bproliferate\b/.test(text) || COUNTER_DOUBLER.test(text)) return true;
  const kinds = [
    ...text.matchAll(new RegExp(String.raw`\b([+\-/0-9a-z]+) counters?\b${NOT_COUNTERSPELL}`, 'g')),
  ]
    .map((m) => m[1])
    .filter(
      (k) => !['a', 'the', 'that', 'those', 'of', 'more', 'any', 'no', 'each', 'its'].includes(k)
    );
  return kinds.some((k) => !MEANINGLESS_COUNTER.test(k));
}

// A library search counts as a tutor only when what it finds isn't a land.
function tutorsNonland(text: string): boolean {
  if (/\btransmute\b|\b(?!land|basic)[a-z]+cycling\b/.test(text)) return true;
  return [
    ...text.matchAll(
      /\bsearch(?:es)? (?:your|their) library (?:and\/or graveyard )?for ([^.]*?)(?:,|\. |$)/g
    ),
  ].some(
    (m) =>
      !/\b(?:land|plains|island|swamp|mountain|forest|basic|gate|desert)\b/.test(m[1]) ||
      /\b(?:creature|artifact|enchantment|instant|sorcery|planeswalker|equipment|aura)\b/.test(m[1])
  );
}

const LAND_ONTO_BATTLEFIELD =
  /\bsearch your library for [^.]*?\b(?:land|plains|island|swamp|mountain|forest|basic)\b[^.]*?\bonto the battlefield\b|\bput (?:up to (?:one|two) |a |any number of )?land cards? [^.]*?onto the battlefield\b|\bplay (?:an|two|three|any number of) additional lands?\b|\bplay any number of lands\b/;

// Sacrificing a land to fetch one land is a swap, not ramp (Crop Rotation).
const LAND_FOR_LAND = /\bsacrifice a land\b(?![^]*\bup to (?:two|three)\b)/;

// Mana beyond your land drop: rocks, dorks, rituals, Treasure. A land counts
// only when one ability makes two or more mana (Ancient Tomb, not Reliquary
// Tower).
function makesExtraMana(card: ScryfallCard, text: string): boolean {
  if (isLand(card)) {
    return (
      /(?:^|[.•"] )\{t\}: add (?:\{[^}]+\}){2,}|\badd (?:two|three|x) mana\b|\badd an amount of\b|\badd \{[a-z]\} for each\b/.test(
        text
      ) ||
      /\bsearch your library for up to (?:two|three) basic land cards?\b|\bcreate (?!or )[^.]*?\btreasure\b/.test(
        text
      )
    );
  }
  return (
    /\badds? (?:\{[^}]+\}|(?:one|two|three|x|that much|an amount of|an additional|additional)\b)/.test(
      text
    ) ||
    /\bcreate (?!or )[^.]*?\btreasure\b/.test(text) ||
    (LAND_ONTO_BATTLEFIELD.test(text) && !LAND_FOR_LAND.test(text)) ||
    /\bspells\b[^.]*?\bcosts? \{[^}]+\} less\b/.test(text)
  );
}

type FeederKeyword = Exclude<CommanderKeyword, 'tribal'>;

const FEEDERS: Record<FeederKeyword, (text: string, card: ScryfallCard) => boolean> = {
  etb: (t) => BLINK.test(t) || ETB_DOUBLER.test(t),
  'attack-trigger': (t) =>
    GRANTS_EVASION.test(t) ||
    UNBLOCKABLE.test(t) ||
    /\badditional combat\b/.test(t) ||
    ATTACK_PAYOFF.test(t),
  sacrifice: (t) =>
    YOU_CREATE_TOKEN.test(t) ||
    TOKEN_DOUBLER.test(t) ||
    SAC_OUTLET.test(t) ||
    DEATH_PAYOFF.test(t) ||
    OWN_DEATH_VALUE.test(t),
  'dies-trigger': (t) =>
    YOU_CREATE_CREATURE_TOKEN.test(t) ||
    TOKEN_DOUBLER.test(t) ||
    CREATURE_SAC_OUTLET.test(t) ||
    DEATH_PAYOFF.test(t) ||
    OWN_DEATH_VALUE.test(t),
  'plus-one-counters': (t) =>
    /\+1\/\+1 counters?\b|\bproliferate\b/.test(t) || COUNTER_DOUBLER.test(t),
  'minus-counters': (t) =>
    /-1\/-1 counters?\b|\b(?:proliferate|wither|infect)\b/.test(t) ||
    (COUNTER_DOUBLER.test(t) && !/\+1\/\+1 counters?\b/.test(t)),
  proliferate: (t) => placesMeaningfulCounters(t),
  'counters-generic': (t) => placesMeaningfulCounters(t),
  'leaves-battlefield': (t) => BLINK.test(t) || SAC_OUTLET.test(t),
  tokens: (t) => YOU_CREATE_TOKEN.test(t) || TOKEN_DOUBLER.test(t) || ANTHEM.test(t),
  lifegain: (t) =>
    /\bgain (?:\d+ |x |that much |life\b)|\byou gain\b|\blifelink\b|\bwhenever you gain life\b|\bcreate (?!or )[^.]*?\bfood\b/.test(
      t
    ),
  'lifeloss-drain': (t) =>
    /\b(?:each|target) (?:opponent|player) loses\b|\btarget opponent\b[^.]*?\bloses\b|\bextort\b|\bwhenever an opponent loses life\b|\bopponent would lose life\b|\b(?:that player|defending player|each other player|each player) loses\b|\bdrain\b/.test(
      t
    ),
  draw: (t) =>
    /(?<!opponent |can't )\bdraws? (?:a|an|one|two|three|four|five|six|seven|x|that many|\d+|cards?|an additional)\b/.test(
      t
    ) ||
    /\binvestigate\b|\bcreate (?!or )[^.]*?\bclue\b|\byou become the monarch\b|\bconnives?\b|\bcycling\b/.test(
      t
    ),
  'wheel-discard': (t) =>
    /\beach player discards\b|\beach player [^.]*?\bdraws seven\b|\bdiscards? (?:their|your) hand\b|\bdiscard (?:a card at random|one or more cards)\b|\bdraws? [^.]*?\bthen discards?\b|\bdraw [^.]*?\. if you do, discard\b|\bdiscard (?:a|two) cards?: |\bdraw [^.]*?\bthen discard\b|\bdiscard [^.]*?cards?[.,]? (?:then )?draw\b|\bwhenever (?:you|a player|an opponent|one or more (?:players|opponents)) discards?\b|\bmadness\b|\bput into (?:a|your) graveyard from anywhere\b|\bconnives?\b|\blearn\b/.test(
      t
    ),
  tutor: (t) => tutorsNonland(t),
  mill: (t) =>
    /\bmills?\b|\bsurveil\b|\bdredge\b|\bput the top [^.]*?\bcards? of [^.]*?\blibrary into [^.]*?\bgraveyard\b|\bsearch your library for [^.]*?\bput (?:it|them|that card|those cards) into your graveyard\b/.test(
      t
    ),
  'graveyard-recursion': (t) =>
    /\bfrom (?:your|a) graveyard\b|\breturn\b[^.]*?\bgraveyard\b|\b(?:unearth|flashback|escape|disturb|embalm|eternalize|jump-start|retrace|aftermath)\b/.test(
      t
    ) ||
    /\b(?:return|put|cast|play)\b[^.]*?\bfrom (?:their|all|any) graveyards?\b|\bcards? in (?:your|a) graveyard\b.*\breturn\b|\b(?:from|in) (?:their|all|any) graveyards?\b.*\bonto the battlefield\b|\blibrary and\/or graveyard\b/.test(
      t
    ),
  spellcast: (t) =>
    !/^counter target\b/.test(t) &&
    /\bwhenever you cast (?:an? |your (?:first|second) )?(?:instant|sorcery|noncreature|spell|aura, equipment)\b|\bmagecraft\b|\bprowess\b|\bstorm\b|\bcopy (?:target|that|it)\b[^.]*?\b(?:spell|instant|sorcery)\b|\b(?:instant|sorcery|instant and sorcery|instant or sorcery|noncreature) spells you cast cost\b/.test(
      t
    ),
  'artifact-matters': (t) =>
    /\bartifacts? you control\b|\bfor each artifact\b|\bmetalcraft\b|\baffinity for artifacts\b|\bimprovise\b|\bwhenever (?:you cast )?(?:an? |another )?(?:nontoken )?artifact\b[^.]*?\b(?:spell|enters)\b|\bartifact spells?\b|\bsacrifice an artifact\b(?!,| or (?:creature|enchantment|land|planeswalker))|\binvestigate\b|\ban? artifact\b[^.]*?\b(?:enters|entering)\b|\bcopy of (?:an? |target )?artifact\b|\bcontrol (?:an?|three or more) artifacts?\b|\bartifact cards? from your graveyard\b/.test(
      t
    ) ||
    /\bcreate (?!or )[^.]*?\b(?:treasure|clue|food|blood|map|powerstone|gold|thopter|servo|construct|artifact)\b[^.]*?\btokens?\b|\b(?:return|search your library for)[^.]*?\bartifact\b(?: or [a-z]+)? cards?\b/.test(
      t
    ),
  'enchantment-matters': (t) =>
    /\benchantments? you control\b|\bfor each enchantment\b|\bconstellation\b|\bwhenever (?:you cast )?(?:an? |another )?(?:aura|enchantment)\b[^.]*?\b(?:spell|enters)\b|(?<!counter target )\benchantment spells?\b|\bwhenever you cast an aura\b|\benchantment cards? from your graveyard\b/.test(
      t
    ) ||
    /\bcreate (?!or )[^.]*?\benchantment\b[^.]*?\btokens?\b|\b(?:return|search your library for)[^.]*?\b(?:enchantment|aura) cards?\b/.test(
      t
    ),
  landfall: (t) =>
    /\blandfall\b|\bwhenever (?:~ or )?(?:a|another) land (?:you control )?enters\b|\bplay lands? from your graveyard\b|\bland cards? from your graveyard\b|\breturn (?:a|target) land you control to its owner's hand\b|\breturn [^.]*?\bpermanent cards?\b[^.]*?\bfrom your graveyard to the battlefield\b/.test(
      t
    ) || LAND_ONTO_BATTLEFIELD.test(t),
  'extra-combat': (t) =>
    /\badditional combat\b|\bwhenever\b[^.]*?\battacks?\b/.test(t) &&
    !/\bwhenever an opponent attacks\b/.test(t),
  'extra-turn': (t) => /\bextra turn\b|\badditional turn\b/.test(t),
  'untap-engine': (t) =>
    !/\bgain control\b/.test(t) &&
    /\buntap (?:(?:target|all|each|another|up to (?:one|two|three|four|five|x)|two|three|x|those|that|it|them|equipped|enchanted)\b|~)/.test(
      t
    ),
  monarch: (t) => /\bmonarch\b/.test(t),
  'group-hug': (t) =>
    /\beach player (?:draws|gains|may (?:draw|put|search|play)|puts? a land|searches|creates|adds|untaps)\b|\beach player discards [^.]*?\bthen draws\b|\beach opponent (?:draws|gains|may draw|creates)\b|\btarget opponent (?:draws|gains|creates|may draw)\b|\byou and (?:target|each|that) (?:opponent|player)s? each draw\b|\bvote\b|\bgift a card\b/.test(
      t
    ),
  ramp: (t, card) => makesExtraMana(card, t),
  voltron: (t, card) => {
    const tl = frontTypeLine(card).toLowerCase();
    if (tl.includes('equipment')) return true;
    if (tl.includes('aura')) {
      return /\benchanted creature (?:gets \+|has|gains|can't be blocked)/.test(t);
    }
    return (
      GRANTS_PROTECTION.test(t) ||
      GRANTS_EVASION.test(t) ||
      UNBLOCKABLE.test(t) ||
      PHASES_OUT.test(t) ||
      THEN_IT_GAINS.test(t) ||
      /\battach (?:any number of |target )?equipment\b|\bequipment you control\b/.test(t)
    );
  },
};

/** The pill each check shows on a card it matches. */
export const PILL_REASONS: Record<FeederKeyword, string> = {
  etb: 'Re-triggers ETB effects',
  'attack-trigger': 'Evasion or attack payoff',
  sacrifice: 'Sac fodder, outlet or payoff',
  'dies-trigger': 'Triggers / feeds your death payoff',
  'plus-one-counters': 'Adds or pays off +1/+1 counters',
  'minus-counters': 'Adds or pays off -1/-1 counters',
  proliferate: 'Places or scales counters',
  'counters-generic': 'Cares about counters',
  'leaves-battlefield': 'Bounces/blinks to retrigger leave effects',
  tokens: 'Makes or pumps tokens',
  lifegain: 'Gains life / lifegain payoff',
  'lifeloss-drain': 'Drains opponents',
  draw: 'Refills your hand',
  'wheel-discard': 'Wheel / discard synergy',
  tutor: 'Tutors for your key pieces',
  mill: 'Fills graveyards',
  'graveyard-recursion': 'Recurs cards from the graveyard',
  spellcast: 'Spellslinger payoff or enabler',
  'artifact-matters': 'Cares about artifacts',
  'enchantment-matters': 'Cares about enchantments',
  landfall: 'Triggers / enables landfall',
  'extra-combat': 'Extra combat / attack payoff',
  'extra-turn': 'Extra-turn synergy',
  'untap-engine': 'Untap / combo enabler',
  monarch: 'Monarch synergy',
  'group-hug': 'Group / political synergy',
  ramp: 'Mana acceleration / payoff',
  voltron: 'Suits up / protects your commander',
};

/**
 * Explain why a candidate card synergizes with this commander. Returns
 * short, deduped reason strings (empty if no synergy detected). Used for
 * "why this card" badges on recommendations.
 */
export function whyCardMatches(
  card: ScryfallCard,
  profile: CommanderProfile,
  maxReasons = 3
): string[] {
  const text = feederText(card);
  const reasons: string[] = [];

  for (const ability of profile.abilities) {
    if (ability.keyword === 'tribal') {
      const cardTribes = detectTribes(card);
      const shared = cardTribes.filter((t) => profile.tribes.includes(t));
      if (shared.length > 0) {
        reasons.push(`Shares your ${shared.map(cap).join(' / ')} tribe`);
      }
      continue;
    }
    if (FEEDERS[ability.keyword](text, card)) {
      reasons.push(PILL_REASONS[ability.keyword]);
    }
  }

  // Dedupe while preserving order, then cap.
  return [...new Set(reasons)].slice(0, maxReasons);
}
