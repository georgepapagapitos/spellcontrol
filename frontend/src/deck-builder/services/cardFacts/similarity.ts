/**
 * A card's canonical tag set for functional similarity (Jaccard), so a later
 * slice can rank substitutes: two cards that do the same thing share tags even
 * when their names and printed numbers differ.
 *
 * Tags carry no raw numbers (amounts are dropped; normalize.ts `numberless` is
 * the same idea for text). They are:
 *  - T:event/object/who           each trigger
 *  - E:verb/object/who[@mass]     each effect
 *  - T:…>E:…                      each (trigger, effect) tuple, the strongest
 *                                 signal: Grave Pact, Dictate of Erebos and
 *                                 Butcher of Malakir share
 *                                 T:dies/creature/you>E:sacrifice/creature/opp
 *  - K:kind>E:…                   an untriggered ability's kind with its effect
 *  - S:speed                      how each effect-bearing ability is used
 *  - L:limit                      each condition on an effect (numbers folded:
 *                                 "mv<=3" is L:mv-cap)
 *  - C:cost                       each activated-cost atom (sac outlets)
 *  - R:role, R:role/sub           counted roles
 *  - F:function                   niche functions (functions.ts)
 *  - M:band                       mana value band (0-1, 2, 3, 4, 5-6, 7+)
 *  - Y:type, W:keyword            card types and keywords, the weakest signal
 */
import { FACT_ROLES, countsAsRole, type CardFacts } from './schema';

const ROLE_KEYS = new Set<string>(FACT_ROLES);

function mvBand(mv: number): string {
  return mv <= 1 ? '0-1' : mv <= 4 ? String(Math.floor(mv)) : mv <= 6 ? '5-6' : '7+';
}

const limitTag = (l: string) =>
  `L:${l.replace(/^(mv|power|toughness)(<=|>=)\d+$/, (_m, k: string, op: string) => `${k}-${op === '<=' ? 'cap' : 'floor'}`)}`;

/** "spell:noncreature" → "spell", "token:treasure" → "token", "creature|planeswalker" → "creature". */
const baseObject = (o: string) => o.split(/[:|]/)[0];

export function similarityTags(f: CardFacts): string[] {
  const tags = new Set<string>();
  for (const a of f.abilities) {
    // Each trigger and effect also carries its ancestors (mode, then mode +
    // object kind), the way the otag corpus pre-expands its hierarchy: Rhystic
    // Study ("an opponent casts a spell") and Mystic Remora ("... a
    // noncreature spell") share T:cast/spell even though their full tuples differ.
    const t = a.trigger;
    const trigger = t ? `T:${t.event}/${t.object}/${t.who}` : null;
    if (t) {
      tags.add(`T:${t.event}`);
      tags.add(`T:${t.event}/${baseObject(t.object)}`);
      tags.add(trigger!);
    }
    if (a.effects.length) tags.add(`S:${a.speed}`);
    for (const l of a.limits) tags.add(limitTag(l));
    for (const e of a.effects) {
      const effect = `E:${e.verb}/${e.object}/${e.who}${e.scope === 'mass' ? '@mass' : ''}`;
      tags.add(`E:${e.verb}`);
      tags.add(`E:${e.verb}/${baseObject(e.object)}`);
      tags.add(effect);
      if (t) {
        tags.add(`${trigger}>${effect}`);
        tags.add(`T:${t.event}>E:${e.verb}`);
      } else tags.add(`K:${a.kind}>${effect}`);
      for (const l of e.limits) tags.add(limitTag(l));
    }
    for (const c of a.cost) tags.add(`C:${c}`);
  }
  for (const r of f.roles) {
    if (!countsAsRole(r)) continue;
    tags.add(`R:${r.role}`);
    if (r.sub) tags.add(`R:${r.role}/${r.sub}`);
  }
  for (const key of Object.keys(f.strengths))
    if (!key.includes('/') && !ROLE_KEYS.has(key)) tags.add(`F:${key}`);
  if (f.mv !== null) tags.add(`M:${mvBand(f.mv)}`);
  for (const t of f.types) tags.add(`Y:${t}`);
  for (const k of f.keywords) tags.add(`W:${k}`);
  return [...tags].sort();
}

/** Jaccard overlap of two tag sets (1 = identical, 0 = disjoint). */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const sb = new Set(b);
  let inter = 0;
  for (const t of a) if (sb.has(t)) inter++;
  return inter / (a.length + sb.size - inter);
}

/** Inverse document frequency of every tag over a pool: log(N / df). */
export function tagIdf(pool: Iterable<readonly string[]>): Map<string, number> {
  const df = new Map<string, number>();
  let n = 0;
  for (const tags of pool) {
    n++;
    for (const t of new Set(tags)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log(n / d));
  return idf;
}

/**
 * Jaccard weighted by IDF: a shared rare tag (a Grave Pact tuple) counts for
 * more than a shared common one (Y:creature). Unknown tags weigh as the rarest.
 */
const maxIdf = new WeakMap<ReadonlyMap<string, number>, number>();

export function weightedJaccard(
  a: readonly string[],
  b: readonly string[],
  idf: ReadonlyMap<string, number>
): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let max = maxIdf.get(idf);
  if (max === undefined) {
    max = 1;
    for (const v of idf.values()) if (v > max) max = v;
    maxIdf.set(idf, max);
  }
  const rarest = max;
  const w = (t: string) => idf.get(t) ?? rarest;
  let inter = 0;
  let union = 0;
  for (const t of sa) {
    union += w(t);
    if (sb.has(t)) inter += w(t);
  }
  for (const t of sb) if (!sa.has(t)) union += w(t);
  return union === 0 ? 0 : inter / union;
}

/**
 * The `k` most similar cards to `query` among `pool` by Jaccard over
 * similarityTags (IDF-weighted when `idf` is given), ties broken by name for a
 * stable order. The query card itself is skipped.
 */
export function mostSimilar(
  query: CardFacts,
  pool: Iterable<CardFacts>,
  k: number,
  opts: { filter?: (f: CardFacts) => boolean; idf?: ReadonlyMap<string, number> } = {}
): { facts: CardFacts; score: number }[] {
  const q = similarityTags(query);
  const scored: { facts: CardFacts; score: number }[] = [];
  for (const f of pool) {
    if (f.oracleId === query.oracleId || (opts.filter && !opts.filter(f))) continue;
    const tags = similarityTags(f);
    const score = opts.idf ? weightedJaccard(q, tags, opts.idf) : jaccard(q, tags);
    if (score > 0) scored.push({ facts: f, score });
  }
  scored.sort((x, y) => y.score - x.score || x.facts.name.localeCompare(y.facts.name));
  return scored.slice(0, k);
}
