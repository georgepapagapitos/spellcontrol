import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/util/safe-local-storage';
import { MAX_GUESSES, mergeResults, previousDay, type DailyResult } from '@/lib/daily/stats';

/** Guess lists older than this many days are dropped; results are kept. */
const KEEP_GUESS_DAYS = 14;

interface DailyState {
  /** A guest's guesses per UTC day, in order (the server keeps a signed-in player's). */
  guesses: Record<string, string[]>;
  /** Finished puzzles, newest first, one per date. */
  results: DailyResult[];
  /** A guest's finished days the account hasn't seen yet; posted after sign-in. */
  unposted: string[];
  addGuess: (date: string, name: string) => void;
  /** `queue: false` when the server already recorded it (signed-in play). */
  finish: (date: string, result: Omit<DailyResult, 'date'>, opts?: { queue?: boolean }) => void;
  /** Fold in the server's history. The server keeps the first result per day, so it wins. */
  adoptServerResults: (results: readonly DailyResult[]) => void;
  markPosted: (dates: readonly string[]) => void;
}

function cutoff(date: string): string {
  let d = date;
  for (let i = 0; i < KEEP_GUESS_DAYS; i++) d = previousDay(d);
  return d;
}

export const useDailyStore = create<DailyState>()(
  persist(
    (set, get) => ({
      guesses: {},
      results: [],
      unposted: [],
      addGuess: (date, name) => {
        const { guesses, results } = get();
        if (results.some((r) => r.date === date)) return;
        const list = guesses[date] ?? [];
        if (list.length >= MAX_GUESSES || list.includes(name)) return;
        const oldest = cutoff(date);
        const kept = Object.fromEntries(Object.entries(guesses).filter(([d]) => d > oldest));
        set({ guesses: { ...kept, [date]: [...list, name] } });
      },
      finish: (date, result, opts) => {
        const { results, unposted } = get();
        if (results.some((r) => r.date === date)) return;
        const queue = opts?.queue ?? true;
        set({
          results: mergeResults([{ date, ...result }], results),
          unposted: !queue || unposted.includes(date) ? unposted : [...unposted, date],
        });
      },
      adoptServerResults: (server) => {
        set({ results: mergeResults(server, get().results) });
      },
      markPosted: (dates) => {
        const done = new Set(dates);
        set({ unposted: get().unposted.filter((d) => !done.has(d)) });
      },
    }),
    {
      name: 'spellcontrol-daily',
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (s) => ({ guesses: s.guesses, results: s.results, unposted: s.unposted }),
    }
  )
);
