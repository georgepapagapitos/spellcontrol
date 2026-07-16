import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardsByIds, getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { scryfallToEnrichedCard } from './scryfall-to-enriched';
import type { EnrichedCard, ListEntry } from '../types';

export interface EnrichedListRow {
  entry: ListEntry;
  card: EnrichedCard;
}

/** Minimal card for an entry that didn't resolve (offline miss) — still renders
 *  identity (name/set), just can't be filtered by oracle attributes. */
function skeleton(entry: ListEntry): EnrichedCard {
  return {
    copyId: entry.id,
    name: entry.name,
    setCode: entry.setCode,
    setName: '',
    collectorNumber: entry.collectorNumber,
    rarity: '',
    scryfallId: entry.scryfallId,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'list',
    finish: entry.finish,
    foil: entry.finish !== 'nonfoil',
    oracleId: entry.oracleId,
  };
}

interface Resolved {
  key: string;
  byId: Map<string, ScryfallCard>;
  byName: Map<string, ScryfallCard>;
}

/**
 * Resolve a list's printing-reference entries into full EnrichedCards so the
 * list view can filter/sort by type/color/cmc/rarity/oracle like the
 * collection. Entries store exact printing identity, so we batch-resolve their
 * Scryfall ids first (`getCardsByIds`) — art, rarity, finishes, and price then
 * reflect the printing the user actually owns. Entries whose id doesn't
 * resolve (offline — no by-printing index — or stale/withdrawn printings) fall
 * back to name resolution through the cached card client, with the entry's
 * printing identity overlaid so at least set/collector/finish stay accurate.
 * Returns loading=true until the batch resolves.
 */
export function useEnrichedListEntries(entries: ListEntry[]): {
  rows: EnrichedListRow[];
  loading: boolean;
} {
  const ids = useMemo(
    () => [...new Set(entries.map((e) => e.scryfallId).filter(Boolean))].sort(),
    [entries]
  );
  const names = useMemo(
    () =>
      [...new Set(entries.map((e) => e.name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [entries]
  );
  const key = [...ids, ...names].join('|');

  // Resolved cards tagged with the identity key they were resolved for, so a
  // stale resolution from a previous list is never applied.
  const [resolved, setResolved] = useState<Resolved>({
    key: '',
    byId: new Map(),
    byName: new Map(),
  });

  useEffect(() => {
    // Empty list → nothing to resolve; the initial state's empty key already
    // matches key === '', so `ready` is true and rows resolve to [].
    if (ids.length === 0 && names.length === 0) return;
    let cancelled = false;
    void (async () => {
      // getCardsByIds swallows batch failures internally (partial map); the
      // catch here is belt-and-braces so an id-path error still degrades to
      // the name path instead of erroring the view.
      const byId = await getCardsByIds(ids).catch(() => new Map<string, ScryfallCard>());
      const missingNames = [
        ...new Set(
          entries
            .filter((e) => !e.scryfallId || !byId.has(e.scryfallId))
            .map((e) => e.name)
            .filter(Boolean)
        ),
      ];
      let byName = new Map<string, ScryfallCard>();
      if (missingNames.length > 0) {
        try {
          byName = await getCardsByNames(missingNames);
        } catch {
          // Offline/network miss — fall back to skeletons rather than erroring.
        }
      }
      if (!cancelled) setResolved({ key, byId, byName });
    })();
    return () => {
      cancelled = true;
    };
  }, [key, ids, names, entries]);

  const ready = resolved.key === key;

  const rows = useMemo<EnrichedListRow[]>(() => {
    if (!ready) return [];
    return entries.map((entry) => {
      const exact = entry.scryfallId ? resolved.byId.get(entry.scryfallId) : undefined;
      if (exact) {
        // Exact printing resolved — every field (art/rarity/finishes/price)
        // already belongs to the owned printing; just pin the stable copyId.
        const base = scryfallToEnrichedCard(exact, entry.finish);
        return {
          entry,
          card: { ...base, copyId: entry.id, oracleId: entry.oracleId ?? base.oracleId },
        };
      }
      const sc = resolved.byName.get(entry.name);
      const base = sc ? scryfallToEnrichedCard(sc, entry.finish) : skeleton(entry);
      // Overlay the entry's exact printing identity; keep the resolved card's
      // oracle-level fields (cmc/type/colors/text/tags) for filtering.
      // Keep the resolved set name only when the default printing IS the
      // entry's set; otherwise we don't know the real name, so show the code
      // (avoids a set-code/set-name mismatch in the row tooltip + set sort).
      const sameSet = (base.setCode ?? '').toUpperCase() === entry.setCode.toUpperCase();
      const card: EnrichedCard = {
        ...base,
        copyId: entry.id,
        scryfallId: entry.scryfallId,
        setCode: entry.setCode,
        setName: sameSet ? base.setName : entry.setCode.toUpperCase(),
        collectorNumber: entry.collectorNumber,
        oracleId: entry.oracleId ?? base.oracleId,
        finish: entry.finish,
        foil: entry.finish !== 'nonfoil',
      };
      return { entry, card };
    });
  }, [ready, entries, resolved]);

  return { rows, loading: !ready && (ids.length > 0 || names.length > 0) };
}
