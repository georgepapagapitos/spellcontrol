import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
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

/**
 * Resolve a list's printing-reference entries into full EnrichedCards so the
 * list view can filter/sort by type/color/cmc/rarity/oracle like the
 * collection. Entries store only printing identity, so we batch-resolve their
 * names through the cached card client (offline-capable, the same path as
 * useDeckTokens), enrich with the entry's finish, then overlay the entry's
 * exact printing identity + a stable copyId (= entry.id, for preview keys).
 *
 * Oracle-level fields (cmc/type/colors/oracleText/legalities) are
 * printing-agnostic so name resolution is sufficient for filtering; rarity and
 * art reflect the name-resolved default printing — same as the list's existing
 * name-keyed thumbnails. Returns loading=true until the batch resolves.
 */
export function useEnrichedListEntries(entries: ListEntry[]): {
  rows: EnrichedListRow[];
  loading: boolean;
} {
  const names = useMemo(
    () =>
      [...new Set(entries.map((e) => e.name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [entries]
  );
  const key = names.join('|');

  // Resolved cards tagged with the name-set key they were resolved for, so a
  // stale resolution from a previous list is never applied.
  const [resolved, setResolved] = useState<{ key: string; cards: Map<string, ScryfallCard> }>({
    key: '',
    cards: new Map(),
  });

  useEffect(() => {
    // Empty list → nothing to resolve; the initial state's empty key already
    // matches key === '', so `ready` is true and rows resolve to [].
    if (names.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const cards = await getCardsByNames(names);
        if (!cancelled) setResolved({ key, cards });
      } catch {
        // Offline/network miss — fall back to skeletons rather than erroring.
        if (!cancelled) setResolved({ key, cards: new Map() });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, names]);

  const ready = resolved.key === key;

  const rows = useMemo<EnrichedListRow[]>(() => {
    if (!ready) return [];
    return entries.map((entry) => {
      const sc = resolved.cards.get(entry.name);
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
  }, [ready, entries, resolved.cards]);

  return { rows, loading: names.length > 0 && !ready };
}
