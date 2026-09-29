import { useCallback, useEffect, useState } from 'react';
import { fetchFollowing, type BrewerCard } from '../brewers-client';
import { userMessage } from '../user-error';

/**
 * Who the signed-in viewer follows, newest follow first. `brewers` is null
 * until the first answer (the loading sentinel, so nothing sets state
 * synchronously in the effect); `reload` refetches after an error. Pass
 * `enabled=false` for a guest: no request is made.
 */
export function useFollowing(enabled: boolean): {
  brewers: BrewerCard[] | null;
  error: string | null;
  reload: () => void;
} {
  const [brewers, setBrewers] = useState<BrewerCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchFollowing()
      .then((list) => {
        if (cancelled) return;
        setBrewers(list);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(userMessage(err, "Couldn't load who you follow. Try again."));
        setBrewers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, tick]);

  const reload = useCallback(() => {
    setError(null);
    setBrewers(null);
    setTick((n) => n + 1);
  }, []);

  return { brewers, error, reload };
}
