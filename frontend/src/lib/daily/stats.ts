/** A finished Daily puzzle, as the server and the guest store both keep it. */
export interface DailyResult {
  /** UTC day, 'YYYY-MM-DD'. */
  date: string;
  solved: boolean;
  /** 1..MAX_GUESSES; an unsolved puzzle counts MAX_GUESSES. */
  guesses: number;
}

export const MAX_GUESSES = 6;
const DAY_MS = 86_400_000;

export function previousDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/**
 * Consecutive solved days ending at `date`, or at the day before while `date` is
 * still unplayed, so a puzzle in progress never zeroes the streak. A failed day
 * (including `date` itself) or a missing day breaks it. Mirrors
 * backend/src/daily/streak.ts, which computes friends' streaks the same way.
 */
export function computeStreak(results: readonly DailyResult[], date: string): number {
  const solved = new Map(results.map((r) => [r.date, r.solved]));
  const today = solved.get(date);
  if (today === false) return 0;
  let cursor = today ? date : previousDay(date);
  let n = 0;
  while (solved.get(cursor) === true) {
    n += 1;
    cursor = previousDay(cursor);
  }
  return n;
}

/** The longest solved run anywhere in the history. */
export function bestStreak(results: readonly DailyResult[]): number {
  const solvedDays = [...new Set(results.filter((r) => r.solved).map((r) => r.date))].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of solvedDays) {
    run = prev !== null && previousDay(d) === prev ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export interface DailyStats {
  played: number;
  solved: number;
  /** Whole percent, 0 when nothing is played. */
  solvedPct: number;
  streak: number;
  best: number;
  /** distribution[i] = puzzles solved in i + 1 guesses. */
  distribution: number[];
}

export function computeStats(results: readonly DailyResult[], today: string): DailyStats {
  const distribution = Array.from({ length: MAX_GUESSES }, () => 0);
  let solved = 0;
  for (const r of results) {
    if (!r.solved) continue;
    solved += 1;
    if (r.guesses >= 1 && r.guesses <= MAX_GUESSES) distribution[r.guesses - 1] += 1;
  }
  const played = results.length;
  return {
    played,
    solved,
    solvedPct: played === 0 ? 0 : Math.round((solved / played) * 100),
    streak: computeStreak(results, today),
    best: bestStreak(results),
    distribution,
  };
}

/**
 * One result per date, the earliest-recorded kept: the server keeps the first
 * result for a day, so a merge must agree with it.
 */
export function mergeResults(
  primary: readonly DailyResult[],
  secondary: readonly DailyResult[]
): DailyResult[] {
  const byDate = new Map<string, DailyResult>();
  for (const r of [...primary, ...secondary]) if (!byDate.has(r.date)) byDate.set(r.date, r);
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** A day played within this many days makes someone a regular, for Home's reminder. */
const REGULAR_DAYS = 7;

export interface DailyReminder {
  /** The streak today's card would extend; 0 when there's none to keep. */
  streak: number;
  /** Guesses already made today, from a guest's local list (the server keeps a signed-in player's). */
  guessesUsed: number;
}

/**
 * Whether Home should remind the player about today's card: only while it's
 * unfinished, and only for a regular (a result in the last week, or a guess
 * today). Someone who never plays isn't asked every day; their door is the
 * hero's ⋮.
 */
export function dailyReminder(
  results: readonly DailyResult[],
  todayGuesses: number,
  today: string
): DailyReminder | null {
  if (results.some((r) => r.date === today)) return null;
  let oldest = today;
  for (let i = 0; i < REGULAR_DAYS; i++) oldest = previousDay(oldest);
  const regular = todayGuesses > 0 || results.some((r) => r.date >= oldest && r.date < today);
  if (!regular) return null;
  return { streak: computeStreak(results, today), guessesUsed: todayGuesses };
}
