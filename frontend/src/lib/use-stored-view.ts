import { useState } from 'react';
import { readLocalStorage } from './local-storage';

/**
 * Persisted view-mode state for a page.
 *
 * @param key        - localStorage key
 * @param validValues - array of all accepted values
 * @param fallback   - value to use when nothing valid is stored
 */
export function useStoredView<Mode extends string>(
  key: string,
  validValues: readonly Mode[],
  fallback: Mode
): [Mode, (v: Mode) => void] {
  const initial = readLocalStorage<Mode>(
    key,
    (raw) => {
      if ((validValues as readonly string[]).includes(raw)) return raw as Mode;
      throw new Error('invalid mode');
    },
    fallback
  );

  const [view, setViewRaw] = useState<Mode>(initial);

  const setView = (v: Mode) => {
    setViewRaw(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* ignore */
    }
  };

  return [view, setView];
}
