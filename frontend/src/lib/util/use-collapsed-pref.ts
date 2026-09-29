import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Collapsed/expanded state for a panel, persisted to localStorage under `key`
 * as `'1'`/`'0'`. Falls back to `defaultCollapsed` when unset or unreadable
 * (SSR, quota, privacy-mode). Same shape as `useState<boolean>` — the setter
 * accepts a value or a functional updater.
 */
export function useCollapsedPref(
  key: string,
  defaultCollapsed = true
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultCollapsed;
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? defaultCollapsed : raw === '1';
    } catch {
      return defaultCollapsed;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, collapsed ? '1' : '0');
    } catch {
      /* ignore quota / privacy-mode failures */
    }
  }, [key, collapsed]);

  return [collapsed, setCollapsed];
}
