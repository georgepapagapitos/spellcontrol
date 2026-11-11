import { useEffect, useMemo, useRef, useState } from 'react';
import { getCardByName, getCardPrice } from '@/deck-builder/services/scryfall/client';
import type { EDHRECTopCommander } from '@/deck-builder/types';
import type { ColorMode } from '@/lib/deck/commander-finder';
import { getCurrency } from '@/lib/collection/currency';
import { formatMoney } from '@/lib/collection/format-money';
import { fetchPopular, popularEntry, runPool, type Entry } from './commander-finder-shared';
import type { useCommanderReadiness } from './use-commander-readiness';

/** Commanders "Worth buying the commander for" scores, and how many it shows. */
const BUY_POOL = 30;
const BUY_SHOWN = 6;

type Readiness = ReturnType<typeof useCommanderReadiness>;

interface Input {
  showBuy: boolean;
  colors: ReadonlySet<string>;
  colorMode: ColorMode;
  ownedLegendNames: ReadonlySet<string>;
  readiness: Readiness['readiness'];
  ensureReadiness: Readiness['ensureReadiness'];
}

/**
 * "Worth buying the commander for": popular commanders you don't own, ranked by how much of
 * their deck you do, with a price for each shown.
 */
export function useBuyCandidates({
  showBuy,
  colors,
  colorMode,
  ownedLegendNames,
  readiness,
  ensureReadiness,
}: Input) {
  const buyKey = JSON.stringify([showBuy, [...colors].sort(), colorMode]);
  const [buyPool, setBuyPool] = useState<{ key: string; entries: Entry[] }>({
    key: '',
    entries: [],
  });
  const ownedLegendNamesRef = useRef(ownedLegendNames);
  useEffect(() => {
    ownedLegendNamesRef.current = ownedLegendNames;
  }, [ownedLegendNames]);
  useEffect(() => {
    if (!showBuy) return;
    let cancelled = false;
    const [, colorList, mode] = JSON.parse(buyKey) as [boolean, string[], ColorMode];
    void (async () => {
      const list = await fetchPopular(new Set(colorList), mode).catch(
        (): EDHRECTopCommander[] => []
      );
      const pool = list
        .filter(
          (c) => !c.name.includes('//') && !ownedLegendNamesRef.current.has(c.name.toLowerCase())
        )
        .slice(0, BUY_POOL)
        .map(popularEntry);
      if (cancelled) return;
      setBuyPool({ key: buyKey, entries: pool });
      await runPool(
        pool,
        (e) => ensureReadiness(e.name),
        () => cancelled
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [showBuy, buyKey, ensureReadiness]);
  const buyShown = useMemo(() => {
    if (!showBuy || buyPool.key !== buyKey) return [];
    return buyPool.entries
      .flatMap((e) => {
        const r = readiness.get(e.name.toLowerCase());
        return r && r !== 'loading' && r.available && r.percent > 0 ? [{ e, pct: r.percent }] : [];
      })
      .sort((a, b) => b.pct - a.pct)
      .slice(0, BUY_SHOWN)
      .map(({ e }) => e);
  }, [showBuy, buyKey, buyPool, readiness]);
  const buyNames = buyShown.map((e) => e.name).join('|');
  const [buyPrices, setBuyPrices] = useState<Map<string, string | null>>(new Map());
  const pricedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!buyNames) return;
    let cancelled = false;
    void (async () => {
      for (const name of buyNames.split('|')) {
        if (cancelled) return;
        if (pricedRef.current.has(name)) continue;
        pricedRef.current.add(name);
        let price: string | null = null;
        try {
          const raw = getCardPrice(await getCardByName(name), getCurrency());
          price = raw ? formatMoney(Number(raw), { wholeDollars: Number(raw) >= 10 }) : null;
        } catch {
          price = null;
        }
        setBuyPrices((prev) => new Map(prev).set(name, price));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buyNames]);
  return { buyShown, buyPrices };
}
