// Pure scoring over EDHREC card-page "lift" pools (see edhrec/client.ts
// parseCardLiftPool). Given a set of already-picked/seed cards, each with its
// own co-play pool, this aggregates candidates mentioned by multiple seeds
// and ranks them — a candidate clustered across several seeds should outrank
// a single high-lift-but-thin-sample mention. No I/O; the caller supplies
// the pools (typically via fetchCardLiftPool per seed).
import type { LiftEntry } from '@/deck-builder/types';

/** Confidence weight: how many co-occurring decks it takes to trust a lift score. */
export const LIFT_CONFIDENCE_K = 50;

export interface LiftEdge {
  seed: string;
  lift: number;
  coPlayPct: number;
  numDecks: number;
}

export interface LiftCandidate {
  name: string;
  edges: LiftEdge[];
  connectionCount: number;
  bestLift: number;
  bombScore: number;
  clusterScore: number;
  lowSample: boolean;
}

export interface LiftPick {
  candidate: LiftCandidate;
  kind: 'bomb' | 'cluster';
  liftedBy: string[];
  lowSample: boolean;
}

/** Confidence-weighted edge strength: raw lift/co-play, discounted for thin samples. */
export function edgeScore(e: { lift: number; coPlayPct: number; numDecks: number }): number {
  return e.lift * e.coPlayPct * (e.numDecks / (e.numDecks + LIFT_CONFIDENCE_K));
}

/**
 * Fold each seed's lift pool into per-candidate edges, one edge per seed that
 * mentions it. Skips excluded names (case-insensitive — deck vs EDHREC
 * casing can differ) and self-mentions (a seed appearing in its own pool).
 */
export function aggregateLiftCandidates(
  seedPools: ReadonlyMap<string, LiftEntry[]>,
  opts?: { excludeNames?: ReadonlySet<string>; minConnections?: number }
): LiftCandidate[] {
  const exclude = new Set([...(opts?.excludeNames ?? [])].map((n) => n.toLowerCase()));
  const minConnections = opts?.minConnections ?? 1;

  const edgesByName = new Map<string, LiftEdge[]>();
  for (const [seed, pool] of seedPools) {
    const seedLower = seed.toLowerCase();
    for (const entry of pool) {
      const nameLower = entry.name.toLowerCase();
      if (nameLower === seedLower || exclude.has(nameLower)) continue;
      const edges = edgesByName.get(entry.name) ?? [];
      edges.push({ seed, lift: entry.lift, coPlayPct: entry.coPlayPct, numDecks: entry.numDecks });
      edgesByName.set(entry.name, edges);
    }
  }

  const candidates: LiftCandidate[] = [];
  for (const [name, edges] of edgesByName) {
    if (edges.length < minConnections) continue;
    const scores = edges.map(edgeScore);
    candidates.push({
      name,
      edges,
      connectionCount: edges.length,
      bestLift: Math.max(...edges.map((e) => e.lift)),
      bombScore: Math.max(...scores),
      clusterScore: scores.reduce((sum, s) => sum + s, 0),
      lowSample: edges.every((e) => e.numDecks < 50),
    });
  }

  candidates.sort(
    (a, b) =>
      b.connectionCount - a.connectionCount ||
      b.bestLift - a.bestLift ||
      a.name.localeCompare(b.name)
  );
  return candidates;
}

function liftedByFor(candidate: LiftCandidate): string[] {
  return [...candidate.edges]
    .sort((a, b) => edgeScore(b) - edgeScore(a))
    .slice(0, 3)
    .map((e) => e.seed);
}

/**
 * Top picks from the aggregated candidates: one "bomb" (highest single-edge
 * strength, if any candidate clears the lift floor) plus the strongest
 * multi-seed "cluster" picks, ranked by summed edge strength.
 */
export function selectTopLiftPicks(
  candidates: LiftCandidate[],
  opts?: { max?: number }
): LiftPick[] {
  const max = opts?.max ?? 4;
  if (max <= 0) return [];

  const bomb = candidates
    .filter((c) => c.bestLift >= 5)
    .sort((a, b) => b.bombScore - a.bombScore || a.name.localeCompare(b.name))[0];

  const clusters = candidates
    .filter((c) => c.connectionCount >= 2 && c.name !== bomb?.name)
    .sort((a, b) => b.clusterScore - a.clusterScore || a.name.localeCompare(b.name));

  const picks: LiftPick[] = [];
  if (bomb) {
    picks.push({
      candidate: bomb,
      kind: 'bomb',
      liftedBy: liftedByFor(bomb),
      lowSample: bomb.lowSample,
    });
  }
  for (const c of clusters) {
    if (picks.length >= max) break;
    picks.push({ candidate: c, kind: 'cluster', liftedBy: liftedByFor(c), lowSample: c.lowSample });
  }
  return picks.slice(0, max);
}
