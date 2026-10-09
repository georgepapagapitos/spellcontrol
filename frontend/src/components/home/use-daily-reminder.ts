import { useEffect, useState } from 'react';
import { fetchMyDailyResults } from '@/lib/daily/daily-client';
import { dailyReminder, type DailyReminder } from '@/lib/daily/stats';
import { useAuth } from '@/store/auth';
import { useDailyStore } from '@/store/daily';

/**
 * Today's Daily card, if Home should remind the player about it. Signed in, the
 * account's history is read first, so a card solved on another device doesn't
 * show as unplayed here; a failed read falls back to this device's results.
 */
export function useDailyReminder(): { loading: boolean; reminder: DailyReminder | null } {
  const status = useAuth((s) => s.status);
  const results = useDailyStore((s) => s.results);
  // The server's day is the UTC day; the puzzle page keys its lists the same way.
  const today = new Date().toISOString().slice(0, 10);
  const todayGuesses = useDailyStore((s) => s.guesses[today]?.length ?? 0);
  const [read, setRead] = useState(false);

  useEffect(() => {
    if (status !== 'authed') return;
    let live = true;
    fetchMyDailyResults()
      .then((server) => useDailyStore.getState().adoptServerResults(server))
      .catch(() => undefined)
      .finally(() => {
        if (live) setRead(true);
      });
    return () => {
      live = false;
    };
  }, [status]);

  const loading = status === 'authed' ? !read : status !== 'guest';
  return { loading, reminder: loading ? null : dailyReminder(results, todayGuesses, today) };
}
