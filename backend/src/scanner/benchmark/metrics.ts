// Scoring and timing helpers for the scanner benchmark.

export interface Tally {
  n: number;
  /** Queries whose first answer was the right card. */
  top1: number;
  /** Queries with the right card among the first three answers. */
  top3: number;
  /** Pipeline only: queries the matcher called confident, and how many of those were wrong. */
  confident?: number;
  confidentWrong?: number;
  borderline?: number;
  miss?: number;
}

export function newTally(pipeline: boolean): Tally {
  return pipeline
    ? { n: 0, top1: 0, top3: 0, confident: 0, confidentWrong: 0, borderline: 0, miss: 0 }
    : { n: 0, top1: 0, top3: 0 };
}

export function score(tally: Tally, truth: string, ranked: readonly string[]): void {
  tally.n++;
  if (ranked[0] === truth) tally.top1++;
  if (ranked.slice(0, 3).includes(truth)) tally.top3++;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

export interface TimingStats {
  n: number;
  p50: number;
  p95: number;
  max: number;
}

export function timingStats(ms: readonly number[]): TimingStats {
  return {
    n: ms.length,
    p50: round1(percentile(ms, 0.5)),
    p95: round1(percentile(ms, 0.95)),
    max: round1(ms.length ? Math.max(...ms) : 0),
  };
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** "172 of 200 (86.0%)" for the published page. */
export function fraction(k: number, n: number): string {
  return `${k} of ${n} (${n ? ((k / n) * 100).toFixed(1) : '0.0'}%)`;
}
