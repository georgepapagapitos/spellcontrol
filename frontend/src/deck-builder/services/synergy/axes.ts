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

export type AxisKey = 'tokens' | 'counters' | 'sacrifice' | 'lifegain';

export interface SynergyAxis {
  key: AxisKey;
  label: string;
  /** Returns a reason string when the card *produces* on this axis, else null. */
  producer(card: ParsedCard): string | null;
  /** Returns a reason string when the card *pays off* this axis, else null. */
  payoff(card: ParsedCard): string | null;
}

const TOKEN_MAKER_KEYWORDS = ['fabricate', 'amass', 'embalm', 'eternalize', 'afterlife'];

const tokens: SynergyAxis = {
  key: 'tokens',
  label: 'Tokens / go-wide',
  producer(card) {
    const tc = tokenCreation(card.oracle);
    const kwMaker =
      TOKEN_MAKER_KEYWORDS.some((k) => card.keywords.includes(k)) ||
      /\bliving weapon\b|\bfor mirrodin\b/.test(card.oracle);
    if (tc.creaturesForYou || kwMaker) {
      return tc.noncreatureForYou
        ? `creates creature + ${tc.kinds.filter((k) => k !== 'creature').join('/')} tokens`
        : 'creates creature tokens';
    }
    if (tc.noncreatureForYou) return `creates ${tc.kinds.join('/')} tokens`;
    return null;
  },
  payoff(card) {
    if (isTokenDoubler(card.oracle)) return 'doubles the tokens you make';
    if (hasCreatureEtbTrigger(card.oracle)) return 'triggers when your creatures enter';
    if (scalesWithCreatures(card.oracle)) return 'scales with creatures you control';
    if (hasCreatureAnthem(card.oracle)) return 'anthem for your creatures';
    if (card.keywords.includes('convoke')) return 'convoke (token sink)';
    if (/\bpopulate\b/.test(card.oracle)) return 'populate';
    return null;
  },
};

const counters: SynergyAxis = {
  key: 'counters',
  label: '+1/+1 counters',
  producer(card) {
    if (card.keywords.includes('fabricate')) return 'puts +1/+1 counters';
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
    if (SAC_OUTLET.test(card.oracle)) return 'sacrifice outlet';
    return null;
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
    if (card.keywords.includes('lifelink')) return 'lifelink';
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

export const AXES: SynergyAxis[] = [tokens, counters, sacrifice, lifegain];
