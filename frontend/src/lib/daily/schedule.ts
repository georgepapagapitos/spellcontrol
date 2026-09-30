import type { Rarity } from './score';

/** One day's puzzle, as `public/daily-schedule.json` freezes it. */
export interface DailyPuzzle {
  date: string;
  number: number;
  name: string;
  colors: string;
  mv: number;
  typeLine: string;
  rarity: Rarity;
  year: number;
  setName: string;
  /** Rules text with the card's own name already swapped for "this card". */
  rulesText: string;
  flavor: string;
  art: string;
}

export interface DailySchedule {
  version: number;
  generatedAt: string;
  epoch: string;
  puzzles: DailyPuzzle[];
}

const DAY_MS = 86_400_000;

/** The puzzle day is the UTC day, the same for everyone everywhere. */
export function todayUtc(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function msUntilNextPuzzle(now: number = Date.now()): number {
  return DAY_MS - (now % DAY_MS);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/**
 * The puzzle for `date`. The schedule normally runs months ahead (the weekly
 * refresh tops it up); if a stale build has run past its end, the schedule
 * cycles rather than leaving the page empty, keeping the day's own number.
 */
export function puzzleFor(schedule: DailySchedule, date: string): DailyPuzzle | null {
  const { puzzles } = schedule;
  if (puzzles.length === 0) return null;
  const exact = puzzles.find((p) => p.date === date);
  if (exact) return exact;
  const first = puzzles[0]!;
  const offset = daysBetween(first.date, date);
  if (offset < 0) return null;
  const pick = puzzles[offset % puzzles.length]!;
  return { ...pick, date, number: daysBetween(schedule.epoch, date) + 1 };
}

let schedulePromise: Promise<DailySchedule> | null = null;

/** Fetched once per app-open; a failure clears the memo so a retry can refetch. */
export function loadSchedule(): Promise<DailySchedule> {
  schedulePromise ??= fetch('/daily-schedule.json')
    .then((res) => {
      if (!res.ok) throw new Error("Couldn't load today's card. Try again in a moment.");
      return res.json() as Promise<DailySchedule>;
    })
    .catch((err: unknown) => {
      schedulePromise = null;
      throw err;
    });
  return schedulePromise;
}

/** Test hook: forget the memoised fetch. */
export function resetScheduleCache(): void {
  schedulePromise = null;
}
