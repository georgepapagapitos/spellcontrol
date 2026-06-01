/**
 * Synergy axis registry. Each axis classifies a parsed card as a **producer**
 * (feeds the engine) and/or a **payoff** (rewards the engine), returning a short
 * human reason or null. Predicates are written against real Scryfall templating
 * — see `classify.fixtures.ts` for the labeled corpus that gates them.
 *
 * Adding an axis is declarative: append to AXES. The framework is unchanged.
 */
import type { ParsedCard } from './text';
import {
  tokenCreation,
  hasCreatureEtbTrigger,
  hasCreatureAnthem,
  scalesWithCreatures,
  isTokenDoubler,
} from './text';

export type AxisKey =
  | 'tokens'
  | 'counters'
  | 'sacrifice'
  | 'lifegain'
  | 'landfall'
  | 'graveyard'
  | 'artifacts'
  | 'equipment'
  | 'spellslinger'
  | 'enchantress'
  | 'superfriends';

export interface SynergyAxis {
  key: AxisKey;
  label: string;
  /** Returns a reason string when the card *produces* on this axis, else null. */
  producer(card: ParsedCard): string | null;
  /** Returns a reason string when the card *pays off* this axis, else null. */
  payoff(card: ParsedCard): string | null;
}

const has = (card: ParsedCard, kw: string) => card.keywords.includes(kw);

// ── Tokens (creature / go-wide) — noncreature tokens belong to the artifacts axis ──
const CREATURE_TOKEN_KEYWORDS = ['fabricate', 'amass', 'embalm', 'eternalize', 'afterlife'];

const tokens: SynergyAxis = {
  key: 'tokens',
  label: 'Tokens / go-wide',
  producer(card) {
    const tc = tokenCreation(card.oracle);
    const kwMaker =
      CREATURE_TOKEN_KEYWORDS.some((k) => has(card, k)) ||
      /\bliving weapon\b|\bfor mirrodin\b/.test(card.oracle);
    return tc.creaturesForYou || kwMaker ? 'creates creature tokens' : null;
  },
  payoff(card) {
    if (isTokenDoubler(card.oracle)) return 'doubles the tokens you make';
    if (hasCreatureEtbTrigger(card.oracle)) return 'triggers when your creatures enter';
    if (scalesWithCreatures(card.oracle)) return 'scales with creatures you control';
    if (hasCreatureAnthem(card.oracle)) return 'anthem for your creatures';
    if (has(card, 'convoke')) return 'convoke (token sink)';
    if (/\bpopulate\b/.test(card.oracle)) return 'populate';
    return null;
  },
};

const counters: SynergyAxis = {
  key: 'counters',
  label: '+1/+1 counters',
  producer(card) {
    if (has(card, 'fabricate')) return 'puts +1/+1 counters';
    if (/enters with [^.]*\+1\/\+1 counter/.test(card.oracle)) return 'enters with +1/+1 counters';
    if (/\+1\/\+1 counter on (?:a|each|target|this|that|up to)/.test(card.oracle))
      return 'puts +1/+1 counters';
    return null;
  },
  payoff(card) {
    if (/twice that many of those counters/.test(card.oracle)) return 'doubles your +1/+1 counters';
    if (/that many plus one \+1\/\+1 counters/.test(card.oracle)) return 'amplifies +1/+1 counters';
    if (/for each \+1\/\+1 counter/.test(card.oracle)) return 'scales with +1/+1 counters';
    if (/move all counters|move (?:a|one or more|those) counters/.test(card.oracle))
      return 'moves/banks counters';
    if (/remove (?:a|one or more|x|that many) \+1\/\+1 counter/.test(card.oracle))
      return 'spends +1/+1 counters';
    return null;
  },
};

const SAC_OUTLET =
  /sacrifice (?:a|an|another|one or more|two|three|x) (?:other )?(?:creatures?|permanents?|artifacts?|tokens?)/;

const sacrifice: SynergyAxis = {
  key: 'sacrifice',
  label: 'Sacrifice / aristocrats',
  producer(card) {
    // The "producer" here is a sac OUTLET — it consumes fodder to fuel payoffs.
    return SAC_OUTLET.test(card.oracle) ? 'sacrifice outlet' : null;
  },
  payoff(card) {
    if (/whenever [^.]*\bcreature[^.]*\bdies\b/.test(card.oracle))
      return 'pays off creatures dying';
    if (/whenever [^.]*\bdies\b/.test(card.oracle) && /\bcreature\b/.test(card.oracle))
      return 'pays off a creature dying';
    return null;
  },
};

const lifegain: SynergyAxis = {
  key: 'lifegain',
  label: 'Lifegain',
  producer(card) {
    if (has(card, 'lifelink')) return 'lifelink';
    if (/you gain \d+ life/.test(card.oracle)) return 'gains you life';
    return null;
  },
  payoff(card) {
    if (/whenever you gain life/.test(card.oracle)) return 'triggers when you gain life';
    if (/for each \d+ life you (?:gained|have gained)/.test(card.oracle))
      return 'scales with life gained';
    return null;
  },
};

const landfall: SynergyAxis = {
  key: 'landfall',
  label: 'Landfall / lands-matter',
  producer(card) {
    if (/play (?:an?|two|three|x)? ?additional lands?/.test(card.oracle))
      return 'plays extra lands';
    if (/\bland\b/.test(card.oracle) && /onto the battlefield/.test(card.oracle))
      return 'puts lands onto the battlefield';
    return null;
  },
  payoff(card) {
    if (has(card, 'landfall') || /whenever a land(?: you control)? enters/.test(card.oracle))
      return 'landfall payoff';
    return null;
  },
};

const GY_RECUR_KEYWORDS = [
  'flashback',
  'escape',
  'delve',
  'disturb',
  'jump-start',
  'aftermath',
  'unearth',
  'embalm',
  'eternalize',
  'encore',
];

const graveyard: SynergyAxis = {
  key: 'graveyard',
  label: 'Graveyard / recursion',
  producer(card) {
    // Self-mill / fill-your-yard. "into your graveyard" (yours), not "into a
    // graveyard" — the latter is graveyard *hate* (Rest in Peace).
    if (
      has(card, 'mill') ||
      /\bmills?\b/.test(card.oracle) ||
      /into your graveyard/.test(card.oracle)
    )
      return 'fills your graveyard';
    if (has(card, 'surveil') || /\bsurveil\b/.test(card.oracle)) return 'surveil';
    return null;
  },
  payoff(card) {
    if (
      /(?:put|return) target [^.]*card from a graveyard (?:onto|to) the battlefield/.test(
        card.oracle
      )
    )
      return 'reanimates';
    if (/return (?:target )?[^.]*card[^.]*from (?:your|a) graveyard/.test(card.oracle))
      return 'recurs from your graveyard';
    if (/from your graveyard (?:to|onto) the battlefield/.test(card.oracle))
      return 'recurs from your graveyard';
    if (/creature card in a graveyard/.test(card.oracle)) return 'reanimates';
    if (GY_RECUR_KEYWORDS.some((k) => has(card, k))) return 'graveyard recursion';
    if (/cast [^.]*from your graveyard/.test(card.oracle)) return 'casts from your graveyard';
    return null;
  },
};

const ARTIFACT_TOKEN_KEYWORDS = ['treasure', 'food', 'clue', 'blood', 'gold', 'powerstone', 'map'];

const artifacts: SynergyAxis = {
  key: 'artifacts',
  label: 'Artifacts',
  producer(card) {
    const tc = tokenCreation(card.oracle);
    if (tc.noncreatureForYou) return 'creates artifact tokens';
    if (/artifact (?:creature )?token/.test(card.oracle)) return 'creates artifact tokens';
    if (has(card, 'fabricate')) return 'fabricate (servo tokens)';
    if (ARTIFACT_TOKEN_KEYWORDS.some((k) => has(card, k))) return 'creates artifact tokens';
    return null;
  },
  payoff(card) {
    if (
      /whenever (?:an?|one or more|another) artifacts?(?: you control)? (?:enters?|is put into|leaves)/.test(
        card.oracle
      )
    )
      return 'triggers on your artifacts';
    if (/whenever you cast an artifact spell/.test(card.oracle))
      return 'pays off casting artifacts';
    if (
      has(card, 'affinity') ||
      has(card, 'improvise') ||
      has(card, 'metalcraft') ||
      /metalcraft/.test(card.oracle)
    )
      return 'artifact threshold/cost payoff';
    if (/for each artifact you control/.test(card.oracle)) return 'scales with artifacts';
    return null;
  },
};

const equipment: SynergyAxis = {
  key: 'equipment',
  label: 'Equipment / Voltron',
  producer(card) {
    // The equipment cards themselves are the engine; the payoffs care about them.
    if (card.typeLine.includes('equipment') || has(card, 'equip')) return 'equipment';
    return null;
  },
  payoff(card) {
    if (/whenever you cast[^.]*equipment/.test(card.oracle)) return 'pays off casting equipment';
    if (/whenever an equipment[^.]*enters/.test(card.oracle)) return 'triggers on your equipment';
    if (/equipment you control/.test(card.oracle)) return 'cares about your equipment';
    if (/equipment card/.test(card.oracle)) return 'tutors/cares about equipment';
    return null;
  },
};

const spellslinger: SynergyAxis = {
  key: 'spellslinger',
  label: 'Spellslinger',
  producer(card) {
    if (
      /(?:instant and sorcery|instant or sorcery|instant|sorcery) spells? you cast cost/.test(
        card.oracle
      )
    )
      return 'reduces spell cost';
    if (/copy (?:target )?(?:instant|sorcery)/.test(card.oracle)) return 'copies spells';
    return null;
  },
  payoff(card) {
    if (has(card, 'magecraft') || has(card, 'prowess')) return 'magecraft/prowess';
    if (/whenever you cast (?:or copy )?(?:an? )?(?:instant|sorcery)/.test(card.oracle))
      return 'triggers on instants/sorceries';
    if (/whenever you cast[^.]*instant or sorcery/.test(card.oracle))
      return 'triggers on instants/sorceries';
    return null;
  },
};

const enchantress: SynergyAxis = {
  key: 'enchantress',
  label: 'Enchantress / enchantments',
  producer(card) {
    if (/enchantment spells? you cast cost/.test(card.oracle)) return 'reduces enchantment cost';
    if (/enchantment token/.test(card.oracle)) return 'creates enchantment tokens';
    if (/(?:search|return)[^.]*enchantment card/.test(card.oracle)) return 'tutors enchantments';
    return null;
  },
  payoff(card) {
    if (has(card, 'constellation')) return 'constellation';
    if (/whenever you cast an enchantment/.test(card.oracle)) return 'triggers on enchantments';
    if (/whenever an enchantment you control enters/.test(card.oracle))
      return 'triggers on enchantments';
    return null;
  },
};

const superfriends: SynergyAxis = {
  key: 'superfriends',
  label: 'Superfriends / planeswalkers',
  producer(card) {
    // The planeswalkers themselves are the engine pieces (mirrors how `equipment`
    // treats equipment cards as producers); proliferate and direct loyalty adders
    // feed their loyalty, and planeswalker tutors deploy them. NOTE: generic
    // counter-doublers (Doubling Season, Vorinclex) are deliberately *not* here —
    // their templating is "counters", not loyalty-specific, so they read as the
    // `counters` axis. Only loyalty-named or planeswalker-named text qualifies.
    if (card.typeLine.includes('planeswalker')) return 'planeswalker (loyalty engine)';
    if (has(card, 'proliferate') || /\bproliferate\b/.test(card.oracle)) return 'proliferate';
    if (/(?:enters with|put|add)[^.]*loyalty counter/.test(card.oracle))
      return 'adds loyalty counters';
    if (/(?:search|reveal|return|put)[^.]*planeswalker card/.test(card.oracle))
      return 'tutors planeswalkers';
    return null;
  },
  payoff(card) {
    // "you control" / "loyalty ability" / "planeswalker spell" gate out removal
    // ("destroy target ... planeswalker") and opponents' walkers ("they control").
    if (/for each planeswalker you control/.test(card.oracle))
      return 'scales with your planeswalkers';
    if (/planeswalkers? you control/.test(card.oracle)) return 'cares about your planeswalkers';
    if (/loyalty abilit/.test(card.oracle)) return 'rewards loyalty activations';
    if (/cast (?:a |an |target )?planeswalker spells?/.test(card.oracle))
      return 'pays off casting planeswalkers';
    return null;
  },
};

export const AXES: SynergyAxis[] = [
  tokens,
  counters,
  sacrifice,
  lifegain,
  landfall,
  graveyard,
  artifacts,
  equipment,
  spellslinger,
  enchantress,
  superfriends,
];
