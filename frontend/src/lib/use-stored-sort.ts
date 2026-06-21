import { useCallback, useState } from 'react';
import { readLocalStorage } from './local-storage';

type SortDir = 'asc' | 'desc';

interface StoredSort<Field extends string> {
  field: Field;
  dir: SortDir;
}

/**
 * Persisted sort state for an index page.
 *
 * @param key           - localStorage key
 * @param defaultDirMap - record mapping each valid field to its default direction;
 *                        also acts as the valid-field set
 * @param defaultField  - field to use when nothing is stored
 */
export function useStoredSort<Field extends string>(
  key: string,
  defaultDirMap: Record<Field, SortDir>,
  defaultField: Field
): {
  sortField: Field;
  sortDir: SortDir;
  toggleSort: (field: Field) => void;
} {
  const defaultDir = defaultDirMap[defaultField];

  const initial = readLocalStorage<StoredSort<Field>>(
    key,
    (raw) => {
      const parsed = JSON.parse(raw) as StoredSort<Field>;
      if (!(parsed.field in defaultDirMap)) throw new Error('invalid field');
      return parsed;
    },
    { field: defaultField, dir: defaultDir }
  );

  const [sortField, setSortField] = useState<Field>(initial.field);
  const [sortDir, setSortDir] = useState<SortDir>(initial.dir);

  const persist = useCallback(
    (field: Field, dir: SortDir) => {
      try {
        localStorage.setItem(key, JSON.stringify({ field, dir }));
      } catch {
        /* ignore */
      }
    },
    [key]
  );

  const toggleSort = useCallback(
    (field: Field) => {
      if (field === sortField) {
        setSortDir((prev) => {
          const next = prev === 'asc' ? 'desc' : 'asc';
          persist(sortField, next);
          return next;
        });
      } else {
        const dir = defaultDirMap[field];
        setSortField(field);
        setSortDir(dir);
        persist(field, dir);
      }
    },
    [sortField, defaultDirMap, persist]
  );

  return { sortField, sortDir, toggleSort };
}
