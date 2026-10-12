import type { EnrichedCard } from '@/types/index';
import { PLAYSTYLES, type Playstyle } from './commander-playstyle-index';
import type { ReadinessScore } from './commander-readiness';

/**
 * Collection leans (E284) — the inverse of the E283 coverage ranking, pure and
 * network-free. E283 starts from a commander and asks how much of its deck you
 * own. This starts from the cards you own and asks which EDHREC theme page each
 * color of them skews toward ("your white leans tokens"), so the finder can then
 * fetch only those pages' commanders.
 *
 * The skew is a lift: the share of a color's cards that play a playstyle (by the
 * same rules-text pattern the commander finder uses) over the share of the whole
 * collection that does. Raw share alone would call every color "control"
 * (`counter target`, `tap target` are everywhere); lift asks what the color has
 * more of than the rest of your cards do.
 */

export const LEAN_COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
export type LeanColor = (typeof LEAN_COLORS)[number];

export const LEAN_COLOR_WORD: Record<LeanColor, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
};

/** Single-color cards a color needs before its skew says anything. */
export const MIN_COLOR_CARDS = 25;
/** Cards of that color that must play the playstyle: a lone card is not a lean. */
export const MIN_LEAN_MATCHES = 5;
/** How much more common than in the whole collection a playstyle must be. */
export const MIN_LEAN_LIFT = 1.3;
/** Leans surfaced, so at most this many tag pages are fetched. */
export const MAX_LEANS = 3;

export interface Lean {
  color: LeanColor;
  playstyleId: string;
  /** EDHREC tag page slug to fetch. */
  slug: string;
  label: string;
  /** Cards of this color that play the playstyle. */
  matches: number;
  /** Single-color cards of this color, one per name. */
  of: number;
  /** Share of this color's cards over the share of the whole collection. */
  lift: number;
}

interface Detector {
  playstyle: Playstyle & { edhrecSlug: string };
  re: RegExp;
}

// Only playstyles with both a rules-text pattern and an EDHREC page can lean:
// the pattern reads the cards, the page is where the commanders come from.
const DETECTORS: Detector[] = PLAYSTYLES.flatMap((p) =>
  p.oracle && p.edhrecSlug
    ? [{ playstyle: p as Playstyle & { edhrecSlug: string }, re: new RegExp(p.oracle, 'i') }]
    : []
);

const isLean = (c: string): c is LeanColor => (LEAN_COLORS as readonly string[]).includes(c);

/**
 * The top lean of each color with enough cards to judge, strongest first, at
 * most {@link MAX_LEANS}. Deterministic: ties break on matches, then on the
 * playstyle's place in the index.
 */
export function computeCollectionLeans(cards: readonly EnrichedCard[]): Lean[] {
  const seen = new Set<string>();
  const colorCards = new Map<LeanColor, number>();
  const hits = new Map<LeanColor, Map<string, number>>();
  const totalHits = new Map<string, number>();
  let total = 0;

  for (const card of cards) {
    const key = card.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const text = card.oracleText;
    if (!text || (card.typeLine ?? '').includes('Land')) continue;
    total += 1;
    const ids = DETECTORS.filter((d) => d.re.test(text)).map((d) => d.playstyle.id);
    for (const id of ids) totalHits.set(id, (totalHits.get(id) ?? 0) + 1);

    const identity = card.colorIdentity ?? [];
    if (identity.length !== 1 || !isLean(identity[0])) continue;
    const color = identity[0];
    colorCards.set(color, (colorCards.get(color) ?? 0) + 1);
    const byStyle = hits.get(color) ?? new Map<string, number>();
    for (const id of ids) byStyle.set(id, (byStyle.get(id) ?? 0) + 1);
    hits.set(color, byStyle);
  }

  const leans: Lean[] = [];
  for (const color of LEAN_COLORS) {
    const of = colorCards.get(color) ?? 0;
    if (of < MIN_COLOR_CARDS) continue;
    let best: Lean | null = null;
    for (const { playstyle } of DETECTORS) {
      const matches = hits.get(color)?.get(playstyle.id) ?? 0;
      const all = totalHits.get(playstyle.id) ?? 0;
      if (matches < MIN_LEAN_MATCHES || all === 0) continue;
      const lift = matches / of / (all / total);
      if (lift < MIN_LEAN_LIFT) continue;
      if (!best || lift > best.lift || (lift === best.lift && matches > best.matches)) {
        best = {
          color,
          playstyleId: playstyle.id,
          slug: playstyle.edhrecSlug,
          label: playstyle.label,
          matches,
          of,
          lift,
        };
      }
    }
    if (best) leans.push(best);
  }
  return leans.sort((a, b) => b.lift - a.lift || b.matches - a.matches).slice(0, MAX_LEANS);
}

/**
 * Rank a lean's commanders by the E283 coverage number: highest "you own N%"
 * first, ties keeping the page's own order (its popularity). A commander whose
 * staples didn't load, or that shares none with the collection, is left out.
 */
export function rankByCoverage<T extends { name: string }>(
  entries: readonly T[],
  readiness: (name: string) => ReadinessScore | 'loading' | undefined,
  limit: number
): Array<T & { percent: number }> {
  return entries
    .flatMap((e, i) => {
      const r = readiness(e.name);
      return r && r !== 'loading' && r.available && r.percent > 0
        ? [{ e: { ...e, percent: r.percent }, i }]
        : [];
    })
    .sort((a, b) => b.e.percent - a.e.percent || a.i - b.i)
    .slice(0, limit)
    .map(({ e }) => e);
}
