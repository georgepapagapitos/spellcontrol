import { useEffect, useRef, useState, type RefObject } from 'react';
import { fetchProductCommanderSummary } from './api';
import { createLimiter } from './concurrency-limit';
import type { ProductCommanderSummary } from '../types';

/**
 * Lazy per-row commander enrichment for a product row: name, colors and art
 * for the product's commander, fetched once the row nears the viewport.
 *
 * Extracted from `ProductSearchPanel`, which grew it for the Add-a-product
 * search, so the starter-deck picker can show the same "name · commander"
 * row without a second copy of the observer + cache + limiter dance.
 *
 * The limiter caps concurrent `/summary` fetches so scrolling a long list
 * doesn't fire dozens at once, and the cache remembers results across
 * re-renders, scrolls and surfaces (the backend caches too; this avoids even
 * the round-trip).
 */
const summaryLimiter = createLimiter(4);
const summaryCache = new Map<string, ProductCommanderSummary | null>();

async function load(fileName: string): Promise<ProductCommanderSummary | null> {
  const cached = summaryCache.get(fileName);
  if (cached !== undefined) return cached;
  try {
    const summary = await summaryLimiter(() => fetchProductCommanderSummary(fileName));
    summaryCache.set(fileName, summary);
    return summary;
  } catch {
    // Treat a failed enrichment as "no commander" — the row still works.
    summaryCache.set(fileName, null);
    return null;
  }
}

/**
 * Resolve a product's commander now, cache-first. For the moment of choosing
 * a row, where the seat wants the commander and colors whether or not the row
 * ever scrolled into view.
 */
export function ensureProductCommander(
  fileName: string
): ProductCommanderSummary | null | Promise<ProductCommanderSummary | null> {
  const cached = summaryCache.get(fileName);
  return cached !== undefined ? cached : load(fileName);
}

/**
 * `undefined` while unknown, `null` for a product with no commander (or a
 * failed lookup). Attach the returned ref to the row element.
 */
export function useProductCommander<T extends HTMLElement>(
  fileName: string,
  enabled = true
): { summary: ProductCommanderSummary | null | undefined; ref: RefObject<T | null> } {
  const [summary, setSummary] = useState<ProductCommanderSummary | null | undefined>(() =>
    summaryCache.get(fileName)
  );
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!enabled || summary !== undefined) return;
    const el = ref.current;
    if (!el) return;
    let done = false;
    const fetch = () => {
      if (done) return;
      done = true;
      void load(fileName).then(setSummary);
    };
    // Fetch when the row nears the viewport; degrade to an immediate fetch
    // where IntersectionObserver is unavailable.
    if (typeof IntersectionObserver === 'undefined') {
      fetch();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          fetch();
        }
      },
      { rootMargin: '150px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [fileName, enabled, summary]);

  return { summary, ref };
}

/** Color-identity → mana-cost string for `ManaCost`; `{C}` for colorless. */
export function colorIdentityCost(summary: ProductCommanderSummary | null | undefined): string {
  if (!summary) return '';
  return summary.colorIdentity.length > 0
    ? summary.colorIdentity.map((c) => `{${c}}`).join('')
    : '{C}';
}

const COLOR_NAMES: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
};

/** Screen-reader label for a commander's colors (the mana glyphs are decorative). */
export function colorIdentityLabel(summary: ProductCommanderSummary): string {
  if (summary.colorIdentity.length === 0) return 'Colorless';
  return `Colors: ${summary.colorIdentity.map((c) => COLOR_NAMES[c] ?? c).join(', ')}`;
}
