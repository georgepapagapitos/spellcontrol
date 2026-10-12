import { useEffect, useState, useSyncExternalStore } from 'react';
import { getScryfallParkedUntil, subscribeScryfallCooldown } from './scryfall-fetch';

/**
 * Whole seconds left in Scryfall's shared 429 cooldown, 0 when nothing is
 * parked. Ticks once a second only while parked, so an idle page pays nothing.
 */
export function useScryfallCooldownSeconds(): number {
  const until = useSyncExternalStore(subscribeScryfallCooldown, getScryfallParkedUntil, () => 0);
  const [left, setLeft] = useState({ until: 0, seconds: 0 });
  useEffect(() => {
    if (!until) return;
    const tick = () =>
      setLeft({ until, seconds: Math.max(1, Math.ceil((until - Date.now()) / 1000)) });
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [until]);
  return until && left.until === until ? left.seconds : 0;
}
