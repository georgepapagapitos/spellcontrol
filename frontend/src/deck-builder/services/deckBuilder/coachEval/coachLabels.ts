/**
 * Card-level labels from blind ship-gate runs (E539).
 *
 * A gate run leaves free text: each blind critic's `flaws` about the NEW deck,
 * and each differ's `payoffsLost` ("Card -> replaced by X") comparing the NEW
 * deck with its baseline. This turns that text into three label sets per NEW
 * deck, parsed against the deck itself so a name is only ever read as a card:
 *
 *  - weak: an in-deck card a critic names in a clause carrying a negative cue
 *    ("filler", "trap", "off-plan", "should be upgrades", …) and no positive
 *    one ("pull their weight", "the true refuel is", …). An in-deck card named
 *    as neutral context ("the only answer is Vandalblast") is not weak.
 *  - missing: a card NOT in the deck that a critic names at all. Critics name
 *    absent cards as omissions ("no Chaos Warp", "misses Cavern of Souls",
 *    "could use Wheel of Fortune").
 *  - lostPremium: a card a differ says the NEW deck lost, found on the left of
 *    the arrow and present in the baseline deck. The card(s) on the right that
 *    the NEW deck gained are kept as `replacedBy` (a secondary weak label).
 *
 * Names are matched longest-first at word boundaries, case-sensitive, against
 * the deck, the baseline, the commander's EDHREC page and the card universe.
 * A double-faced card also matches by its front face, and a legendary name by
 * the part before its comma when that is unambiguous. Commanders and basic
 * lands are never labels.
 */
import { frontFaceName } from '@/lib/cards/card-text';
import { isBasicLandName } from '@/lib/collection/allocations';

export interface NameMatch {
  /** The canonical card name. */
  name: string;
  /** The text as it appeared. */
  text: string;
  index: number;
}

export interface NameMatcher {
  find(text: string): NameMatch[];
}

interface Entry {
  alias: string;
  name: string;
  /** Universe-only one-word names are ignored at the start of a sentence. */
  weakAlias: boolean;
}

/**
 * A matcher over `names`. `priority` names (the deck, the baseline, the
 * page) win an alias clash and are trusted at a sentence start; the rest of
 * the universe is only matched mid-sentence when it is a single word.
 */
export function buildNameMatcher(
  priority: Iterable<string>,
  universe: Iterable<string> = []
): NameMatcher {
  const byAlias = new Map<string, Entry>();
  const commaAliases = new Map<string, Set<string>>();
  const add = (alias: string, name: string, trusted: boolean) => {
    if (!alias || alias.length < 3) return;
    const prev = byAlias.get(alias);
    if (prev && (!prev.weakAlias || !trusted)) return;
    byAlias.set(alias, { alias, name, weakAlias: !trusted && !alias.includes(' ') });
  };
  const addName = (name: string, trusted: boolean) => {
    add(name, name, trusted);
    if (name.includes(' // ')) add(frontFaceName(name), name, trusted);
    const comma = frontFaceName(name).split(',')[0];
    if (comma !== frontFaceName(name) && comma.length >= 5) {
      const set = commaAliases.get(comma) ?? new Set<string>();
      set.add(name);
      commaAliases.set(comma, set);
    }
  };
  const trusted = new Set<string>();
  for (const n of priority) {
    trusted.add(n);
    addName(n, true);
  }
  for (const n of universe) if (!trusted.has(n)) addName(n, false);
  // A short legendary name ("Purphoros") only when it names one card, or one
  // trusted card.
  for (const [alias, names] of commaAliases) {
    if (byAlias.has(alias)) continue;
    const trustedNames = [...names].filter((n) => trusted.has(n));
    if (trustedNames.length === 1) add(alias, trustedNames[0], true);
    else if (names.size === 1) add(alias, [...names][0], false);
  }

  const byFirstWord = new Map<string, Entry[]>();
  for (const e of byAlias.values()) {
    const first = e.alias.split(/[\s,]/)[0];
    const list = byFirstWord.get(first) ?? [];
    list.push(e);
    byFirstWord.set(first, list);
  }
  for (const list of byFirstWord.values()) list.sort((a, b) => b.alias.length - a.alias.length);

  const isWordChar = (ch: string | undefined) => !!ch && /[A-Za-z0-9'’-]/.test(ch);
  return {
    find(text: string): NameMatch[] {
      const out: NameMatch[] = [];
      const norm = text.replace(/’/g, "'");
      let i = 0;
      while (i < norm.length) {
        if (!/[A-Z0-9]/.test(norm[i]) || isWordChar(norm[i - 1])) {
          i++;
          continue;
        }
        const word = norm.slice(i).split(/[\s,.;:!?()"]/)[0];
        const candidates = byFirstWord.get(word) ?? [];
        const sentenceStart = /(^|[.!?:]\s+|\(\s*|"\s*)$/.test(norm.slice(0, i));
        let hit: Entry | undefined;
        for (const e of candidates) {
          if (!norm.startsWith(e.alias, i)) continue;
          if (isWordChar(norm[i + e.alias.length])) continue;
          if (e.weakAlias && sentenceStart) continue;
          hit = e;
          break;
        }
        if (hit) {
          out.push({ name: hit.name, text: hit.alias, index: i });
          i += hit.alias.length;
        } else {
          i += Math.max(1, word.length);
        }
      }
      return out;
    },
  };
}

/** Sentences of a flaw, split at ". " before a capital (not inside "2.58"). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Clauses of a sentence: a cue in one clause says nothing about another. */
export function splitClauses(sentence: string): string[] {
  return sentence
    .split(/;|:|\s[-–—]\s|,?\s(?:but|while|whereas|although|so the|so)\s/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const NEGATIVE =
  /\b(filler|weak(?:est|er)?|low[- ]impact|trap|dead|cuts?\b|cutting|off[- ](?:plan|theme|color|colour|archetype)|isn't|aren't|doesn't|don't|does not|do not|not a\b|not an\b|poor|slow|clunky|over-?costed|overpriced|situational|questionable|win-more|nonbo|anti-?synergy|underwhelming|awkward|upgrades?\b|replace(?:d|ment)?|should be|no reason|nothing|bad|worse|mediocre|marginal|narrow|jank|pile|too (?:slow|expensive|many|much)|irrelevant|unplayable|redundant|misfit|out of place|strictly worse|outclassed|pointless|wasted?|little synergy|no synergy|hurts|fights?|conflicts?|self-defeating|punish|locks? (?:down )?(?:your|its) own|miscount|mislabel|inflat\w*|padding|not pull|doesn't pull|does not pull|random|binder|leftover|collection fill|junk|vanilla|underpowered|low-power|low power|cute|at best)\b/i;

// Praise only with a verb ("X is strong", "only X and Y pull their weight"):
// a bare "best" also reads in "at best", a bare "staple" in "staples are missing".
const POSITIVE =
  /\b(pull(?:s)? (?:their|its) weight|the (?:true|real|only) (?:refuel|answer|engine|payoffs?|draw|finishers?|win(?:con)?s?)|(?:is|are) (?:a |an )?(?:strong|excellent|great|good|premium|solid|real|the best)|real (?:engine|payoff|draw|refuel))\b/i;

export type MentionKind = 'weak' | 'context' | 'missing' | 'lost' | 'replacement';

export interface LabelMention {
  name: string;
  kind: MentionKind;
  source: 'critic' | 'differ';
  /** The sentence (critic) or entry (differ) it came from. */
  text: string;
}

export interface DeckLabels {
  deck: string;
  weak: string[];
  missing: string[];
  lostPremium: string[];
  replacedBy: string[];
  mentions: LabelMention[];
}

export interface LabelInputs {
  deck: string;
  flaws: readonly string[];
  payoffsLost: readonly string[];
  /** Mainboard names of the NEW (judged) deck. */
  newDeck: readonly string[];
  /** Mainboard names of its baseline (the differ's other side). */
  baseDeck: readonly string[];
  commanders: readonly string[];
  matcher: NameMatcher;
}

function nameSet(names: readonly string[]): Set<string> {
  const s = new Set<string>();
  for (const n of names) {
    s.add(n);
    if (n.includes(' // ')) s.add(frontFaceName(n));
  }
  return s;
}

/** The label sets for one judged deck. */
export function extractDeckLabels(input: LabelInputs): DeckLabels {
  const inNew = nameSet(input.newDeck);
  const inBase = nameSet(input.baseDeck);
  const commanders = nameSet(input.commanders);
  const skip = (n: string) =>
    commanders.has(n) || commanders.has(frontFaceName(n)) || isBasicLandName(n);
  const has = (set: Set<string>, n: string) => set.has(n) || set.has(frontFaceName(n));
  const mentions: LabelMention[] = [];

  for (const flaw of input.flaws) {
    for (const sentence of splitSentences(flaw)) {
      for (const clause of splitClauses(sentence)) {
        const negative = NEGATIVE.test(clause);
        const positive = POSITIVE.test(clause);
        for (const m of input.matcher.find(clause)) {
          if (skip(m.name)) continue;
          const kind: MentionKind = has(inNew, m.name)
            ? negative && !positive
              ? 'weak'
              : 'context'
            : 'missing';
          mentions.push({ name: m.name, kind, source: 'critic', text: sentence });
        }
      }
    }
  }

  for (const entry of input.payoffsLost) {
    const parts = entry.split(/\s*(?:->|→)\s*/);
    const left = parts[0] ?? '';
    const right = parts.slice(1).join(' ');
    const leftNames = input.matcher.find(left).filter((m) => !skip(m.name));
    let lost = leftNames.filter((m) => has(inBase, m.name) && !has(inNew, m.name));
    if (lost.length === 0) lost = leftNames.filter((m) => !has(inNew, m.name)).slice(0, 1);
    for (const m of lost)
      mentions.push({ name: m.name, kind: 'lost', source: 'differ', text: entry });
    for (const m of input.matcher.find(right)) {
      if (skip(m.name) || !has(inNew, m.name) || has(inBase, m.name)) continue;
      mentions.push({ name: m.name, kind: 'replacement', source: 'differ', text: entry });
    }
  }

  const of = (kind: MentionKind) => [
    ...new Set(mentions.filter((m) => m.kind === kind).map((m) => m.name)),
  ];
  const weak = of('weak');
  return {
    deck: input.deck,
    weak,
    missing: of('missing'),
    lostPremium: of('lost'),
    replacedBy: of('replacement'),
    mentions,
  };
}
