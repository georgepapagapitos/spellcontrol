import { useEffect, useState } from 'react';

/**
 * Returns `value` delayed by `delayMs` from the last change. Use to throttle
 * heavy work (filtering large lists, materialize) while keeping the input
 * field responsive to live keystrokes.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
