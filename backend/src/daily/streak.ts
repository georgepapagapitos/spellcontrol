export interface DailyDay {
  date: string;
  solved: boolean;
}

const DAY_MS = 86_400_000;

/** The UTC day before a 'YYYY-MM-DD' date. */
export function previousDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/**
 * Consecutive UTC days of solved results ending at `date` if `date` was
 * solved, or the day before if `date` is unplayed (a puzzle still in play must not
 * zero a streak). A failed day, including `date` itself, or a missing day
 * breaks the run.
 */
export function computeStreak(days: readonly DailyDay[], date: string): number {
  const solved = new Map(days.map((d) => [d.date, d.solved]));
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
