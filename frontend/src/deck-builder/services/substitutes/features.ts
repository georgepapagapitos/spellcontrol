/**
 * Role-conditioned substitute features (E517): how well card C stands in for
 * card Q *as a given role*, measured as a small vector of explainable signals.
 * The ranker (ranker.ts) combines them with fitted weights; the eval
 * (scripts/substitute-eval.mjs) ablates them by name.
 *
 * "Role-conditioned" means the query is "find a substitute for Q as a <role>",
 * not "find cards like Q". Consecrated Sphinx as card draw is its draw
 * trigger, not its 4/6 flying body; Grave Pact as a grave-pact effect is the
 * dies → each-opponent-sacrifices tuple. So the structural signal compares
 * the abilities that carry the role on both sides, and the whole card only
 * as a second, weaker signal.
 *
 * Pure. Card facts come in decoded (cardFacts/index.ts); tag data that is not
 * derived from card facts (the tagger corpus, EDHREC's similar lists) is
 * injected through `FeatureSources`, so tests and the offline eval run the
 * exact code the app runs.
 */
import { frontFaceName, getByCardName } from '@/lib/card-text';
import { FACT_ROLES, countsAsRole, type CardFacts, type FactRole } from '../cardFacts/schema';
import { jaccard, similarityTags, weightedJaccard } from '../cardFacts/similarity';

/** A FactRole ("removal") or a named function from cardFacts/functions.ts ("grave-pact"). */
export type SubstituteRole = string;

export const FEATURES = [
  'roleTags',
  'cardTags',
  'sameEffect',
  'polarity',
  'interaction',
  'roleStrength',
  'mv',
  'type',
  'edhrec',
  'taggerRole',
  'taggerSub',
  'taggerTags',
] as const;
export type FeatureName = (typeof FEATURES)[number];
export type FeatureVector = Record<FeatureName, number>;

/** Signals the facts don't carry, injected by the caller (runtime or eval). */
export interface FeatureSources {
  /** IDF over the whole card-facts universe; null → plain Jaccard. */
  idf: ReadonlyMap<string, number> | null;
  /** EDHREC similar-list rank map for a card (similar name → 0-based rank), or null. */
  similarRank?: (name: string) => ReadonlyMap<string, number> | null;
  /** Tagger primary role, subtype and full tag list for a card name. */
  taggerRole?: (name: string) => string | null;
  taggerSubtype?: (name: string) => string | null;
  taggerTags?: (name: string) => readonly string[];
}

const FACT_ROLE_SET = new Set<string>(FACT_ROLES);
export const isFactRole = (role: string): role is FactRole => FACT_ROLE_SET.has(role);

/**
 * Indexes of the abilities that carry `role` on this card: every counted
 * (primary or secondary) role fact of that role with a real ability behind
 * it. Empty for a function key (functions carry no ability pointer) or when
 * the card doesn't fill the role.
 */
export function roleAbilities(f: CardFacts, role: SubstituteRole): number[] {
  if (!isFactRole(role)) return [];
  const out = new Set<number>();
  for (const r of f.roles)
    if (r.role === role && countsAsRole(r) && r.ability >= 0) out.add(r.ability);
  return [...out].sort((a, b) => a - b);
}

// Tag sets are pure functions of an immutable decoded record; the accessor
// memoizes records, so a WeakMap keeps each card's tags for the session.
const wholeTags = new WeakMap<CardFacts, readonly string[]>();
const roleTagCache = new WeakMap<CardFacts, Map<string, readonly string[]>>();

export function cardTags(f: CardFacts): readonly string[] {
  let t = wholeTags.get(f);
  if (!t) wholeTags.set(f, (t = similarityTags(f)));
  return t;
}

/**
 * The tags of the role-carrying abilities only (plus the role facts, mana
 * value band and types, which similarityTags derives from the record). Falls
 * back to the whole card when no ability carries the role, so a function-key
 * query ("aristocrat-drain") compares whole cards.
 */
export function roleTags(f: CardFacts, role: SubstituteRole): readonly string[] {
  let perRole = roleTagCache.get(f);
  if (!perRole) roleTagCache.set(f, (perRole = new Map()));
  let t = perRole.get(role);
  if (t) return t;
  const keep = roleAbilities(f, role);
  if (keep.length === 0) t = cardTags(f);
  else {
    const kept = new Set(keep);
    t = similarityTags({
      ...f,
      abilities: f.abilities.filter((_, i) => kept.has(i)),
      roles: f.roles.filter((r) => r.role === role),
      strengths: {},
      keywords: [],
    });
  }
  perRole.set(role, t);
  return t;
}

/** A full (trigger → effect) or (ability kind → effect) tuple tag, polarity included. */
const isTupleTag = (t: string) =>
  t.includes('>E:') && (t.startsWith('K:') || /^T:[^>]*\/[^>]*\/[^>]*>/.test(t));

/** The tuple tags of a tag set: what the card does, with whose objects. */
export function tupleTags(tags: readonly string[]): string[] {
  return tags.filter(isTupleTag);
}

/** One side of a tuple tag split into its polarity-free shape and its polarity. */
function splitSide(side: string): { shape: string; who: string | null } {
  const parts = side.split('/');
  if (parts.length < 3) return { shape: side, who: null };
  const [who, mass] = parts[parts.length - 1].split('@');
  return {
    shape: [...parts.slice(0, -1), mass ? `@${mass}` : ''].join('/'),
    who,
  };
}

/**
 * A tuple with its polarity stripped: "T:dies/creature/you>E:sacrifice/creature/opp"
 * → "T:dies/creature/>E:sacrifice/creature/". Two tuples with the same shape and
 * opposed polarity are the classic false friend: Grave Pact watches YOUR
 * creatures die, a card that watches an OPPONENT's creatures die does a
 * different job in the same words.
 */
export function tupleShape(tag: string): string {
  return tag
    .split('>')
    .map((side) => splitSide(side).shape)
    .join('>');
}

/** "you"/"self" against "opp" on either side. "any" and "each" include yours, so they never oppose. */
function opposed(a: string, b: string): boolean {
  const sa = a.split('>').map(splitSide);
  const sb = b.split('>').map(splitSide);
  const mine = (w: string | null) => w === 'you' || w === 'self';
  return sa.some(
    (s, i) =>
      sb[i] !== undefined &&
      ((mine(s.who) && sb[i].who === 'opp') || (s.who === 'opp' && mine(sb[i].who)))
  );
}

/** Tokens of a card's interaction facts on the given abilities (or all when empty). */
function interactionTokens(f: CardFacts, abilities: readonly number[]): string[] {
  const keep = abilities.length > 0 ? new Set(abilities) : null;
  const out = new Set<string>();
  for (const i of f.interaction) {
    if (keep && !keep.has(i.ability)) continue;
    out.add(`mode:${MODE_CLASS[i.mode] ?? i.mode}`);
    out.add(`scope:${i.scope}`);
    out.add(`side:${i.side}`);
    for (const h of i.hits) out.add(`hit:${h}`);
  }
  return [...out];
}

/** Interaction modes that answer a threat the same way for a substitute's purpose. */
const MODE_CLASS: Record<string, string> = {
  destroy: 'remove',
  exile: 'remove',
  tuck: 'remove',
  damage: 'damage',
  shrink: 'damage',
  fight: 'damage',
};

const primaryTypes = (f: CardFacts) => f.types.filter((t) => t !== 'legendary' && t !== 'tribal');

/**
 * The rank of `b` in `a`'s EDHREC similar list or of `a` in `b`'s, whichever
 * is closer. EDHREC lists most double-faced cards under the front face, so a
 * lookup falls back to it (getByCardName).
 */
function similarRankBetween(
  a: string,
  b: string,
  similarRank: FeatureSources['similarRank']
): number | null {
  if (!similarRank) return null;
  const list = (name: string) =>
    similarRank(name) ?? (name.includes(' // ') ? similarRank(frontFaceName(name)) : null);
  const la = list(a);
  const lb = list(b);
  const ab = la ? getByCardName(la, b) : undefined;
  const ba = lb ? getByCardName(lb, a) : undefined;
  if (ab === undefined && ba === undefined) return null;
  return Math.min(ab ?? Infinity, ba ?? Infinity);
}

export interface PairEvidence {
  /** The query's role tuples the candidate shares exactly (polarity included). */
  sharedTuples: string[];
  /** A query tuple the candidate matches in shape but with the other polarity. */
  polarityClash: string | null;
  /** EDHREC similar-list rank between the two cards, when either lists the other. */
  similarRank: number | null;
}

/**
 * The feature vector for "C as a substitute for Q in `role`", with the
 * evidence behind the structural features so the ranker can name a grounded
 * reason. Every feature is in [0, 1]; `polarity` is a penalty (1 = clash).
 */
export function pairFeatures(
  q: CardFacts,
  c: CardFacts,
  role: SubstituteRole,
  src: FeatureSources
): { x: FeatureVector; evidence: PairEvidence } {
  const sim = (a: readonly string[], b: readonly string[]) =>
    src.idf ? weightedJaccard(a, b, src.idf) : jaccard(a, b);
  const qRole = roleTags(q, role);
  const cRole = roleTags(c, role);
  const qAll = cardTags(q);
  const cAll = cardTags(c);

  const qTuples = tupleTags(qRole);
  const cTupleSet = new Set(tupleTags(cAll));
  const sharedTuples = qTuples.filter((t) => cTupleSet.has(t));
  let polarityClash: string | null = null;
  if (sharedTuples.length === 0 && qTuples.length > 0) {
    const cByShape = new Map<string, string[]>();
    for (const t of cTupleSet) {
      const shape = tupleShape(t);
      cByShape.set(shape, [...(cByShape.get(shape) ?? []), t]);
    }
    polarityClash =
      qTuples.find((t) => (cByShape.get(tupleShape(t)) ?? []).some((o) => opposed(t, o))) ?? null;
  }

  const qAbilities = roleAbilities(q, role);
  const cAbilities = roleAbilities(c, role);
  const qInter = interactionTokens(q, qAbilities);
  const cInter = interactionTokens(c, cAbilities);

  const rank = similarRankBetween(q.name, c.name, src.similarRank);
  const qTaggerRole = src.taggerRole?.(q.name) ?? null;
  const qTaggerSub = src.taggerSubtype?.(q.name) ?? null;

  const x: FeatureVector = {
    roleTags: sim(qRole, cRole),
    cardTags: sim(qAll, cAll),
    sameEffect: qTuples.length === 0 ? 0 : sharedTuples.length / qTuples.length,
    polarity: polarityClash ? 1 : 0,
    interaction: qInter.length > 0 && cInter.length > 0 ? jaccard(qInter, cInter) : 0,
    roleStrength: c.strengths[role] ?? 0,
    mv: q.mv !== null && c.mv !== null ? 1 / (1 + Math.abs(q.mv - c.mv)) : 0,
    type: jaccard(primaryTypes(q), primaryTypes(c)),
    edhrec: rank === null ? 0 : 1 / (1 + rank),
    taggerRole: qTaggerRole !== null && src.taggerRole?.(c.name) === qTaggerRole ? 1 : 0,
    taggerSub: qTaggerSub !== null && src.taggerSubtype?.(c.name) === qTaggerSub ? 1 : 0,
    taggerTags: src.taggerTags ? jaccard(src.taggerTags(q.name), src.taggerTags(c.name)) : 0,
  };
  return { x, evidence: { sharedTuples, polarityClash, similarRank: rank } };
}

/**
 * The role a card is most plausibly being replaced AS when no caller names
 * one (the Similar cards strip): its strongest counted role, else its
 * strongest niche function, else null (compare whole cards). Body traits
 * never name a job.
 */
const BODY_TRAITS = new Set(['big-body', 'evasion', 'sac-fodder', 'etb-value', 'mana-sink']);

export function primaryRole(f: CardFacts): SubstituteRole | null {
  let best: { role: string; s: number } | null = null;
  for (const r of f.roles) {
    if (!countsAsRole(r)) continue;
    const s = f.strengths[r.role] ?? 0;
    if (!best || s > best.s) best = { role: r.role, s };
  }
  if (best) return best.role;
  for (const [key, s] of Object.entries(f.strengths)) {
    if (key.includes('/') || isFactRole(key) || BODY_TRAITS.has(key)) continue;
    if (!best || s > best.s) best = { role: key, s };
  }
  return best?.role ?? null;
}
