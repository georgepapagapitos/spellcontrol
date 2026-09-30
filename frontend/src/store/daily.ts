import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/util/safe-local-storage';
import { MAX_GUESSES, mergeResults, previousDay, type DailyResult } from '@/lib/daily/stats';

/** Guess lists older than this many days are dropped; results are kept. */
const KEEP_GUESS_DAYS = 14;

interface DailyState {
  /** Names guessed per UTC day, in order. The last one is the answer when solved. */
  guesses: Record<string, string[]>;
  /** Finished puzzles, newest first, one per date. */
  results: DailyResult[];
  /** Dates whose result the server hasn't confirmed yet (a guest's, or a failed post). */
  unposted: string[];
  addGuess: (date: string, name: string) => void;
  finish: (date: string, result: Omit<DailyResult, 'date'>) => void;
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
      finish: (date, result) => {
        const { results, unposted } = get();
        if (results.some((r) => r.date === date)) return;
        set({
          results: mergeResults([{ date, ...result }], results),
          unposted: unposted.includes(date) ? unposted : [...unposted, date],
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
