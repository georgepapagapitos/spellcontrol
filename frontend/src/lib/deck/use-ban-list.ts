import { useEffect, useState } from 'react';

/**
 * The format's current ban list (Scryfall `banned:<format>`, or the offline
 * oracle store), or null until it loads. The client caches it for an hour.
 *
 * Imported lazily: several suites mock the Scryfall client partially, and a
 * static import would fail them on a missing export they never call.
 */
export function useBanList(format: string): ReadonlySet<string> | null {
  const [loaded, setLoaded] = useState<{ format: string; names: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    let live = true;
    import('@/deck-builder/services/scryfall/client')
      .then((m) => m.getBanList(format))
      .then((names) => {
        if (live) setLoaded({ format, names: new Set(names) });
      })
      .catch(() => {
        /* no list: the per-card legalities still apply */
      });
    return () => {
      live = false;
    };
  }, [format]);
  return loaded?.format === format ? loaded.names : null;
}
