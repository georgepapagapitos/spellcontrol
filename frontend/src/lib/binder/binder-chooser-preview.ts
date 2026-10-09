import { useEffect, useRef, useState } from 'react';
import type { BinderDef, BinderFilter, EnrichedCard, SortEntry } from '@/types/index';
import { materializeBinders } from './materialize';
import { compileFilterGroups, cardMatchesCompiled } from '@spellcontrol/binder-routing';
import type { BinderLayoutInputs } from './use-binder-layout-inputs';

/** A chooser tile's answer to "what will this look like" (E495). */
export interface TilePreview {
  /** Raw rule-match count, waterfall-blind — the same figure the rules editor's
   *  per-group badge would show. */
  matches: number;
  /** What would actually land here once the real binder list (in position
   *  order, this tile's binder appended LAST as a new binder always is) has
   *  taken its share first — first-match-wins, same as `countEffectiveLanding`. */
  lands: number;
  /** Page count for `lands`, at the same 9-pocket/one-side/no-pack defaults a
   *  new binder opens with, so the tile's promise matches what picking it
   *  actually creates. */
  pages: number;
  /** Which existing binders are claiming the difference between `matches` and
   *  `lands`, biggest share first — names the overlap instead of just sizing it. */
  caughtBy: { binderName: string; count: number }[];
}

const DRAFT_ID = '__chooser_tile_preview__';

/**
 * Materializes a would-be binder (this filter + order, appended after every
 * existing binder — a new binder always goes last) against the user's real
 * binder list, in ONE pass, and derives every number a tile needs from it.
 * Deliberately mirrors the new-binder defaults `BinderEditor` opens with
 * (9-pocket, one side, no page-packing) so a tile never promises a page count
 * the created binder doesn't also land on.
 */
export function previewTile(
  filter: BinderFilter,
  sorts: SortEntry[],
  cards: EnrichedCard[],
  binders: BinderDef[],
  layout: Pick<BinderLayoutInputs, 'allocatedCopyIds' | 'setMap'>
): TilePreview {
  const maxPosition = binders.reduce((m, b) => Math.max(m, b.position), -1);
  const now = Date.now();
  const draft: BinderDef = {
    id: DRAFT_ID,
    name: '',
    position: maxPosition + 1,
    filterGroups: [{ filter }],
    sorts,
    pocketSize: 9,
    doubleSided: false,
    fixedCapacity: null,
    color: '#000000',
    packSections: false,
    pageBreakDepth: 1,
    keepPrintingsTogether: false,
    createdAt: now,
    updatedAt: now,
  };
  const result = materializeBinders(cards, [...binders, draft], {
    search: '',
    allocatedCopyIds: layout.allocatedCopyIds,
    setMap: layout.setMap,
  });
  const mine = result.binders.find((b) => b.def.id === DRAFT_ID);
  const lands = mine?.totalCards ?? 0;
  const pages = mine?.totalPages ?? 0;

  const compiled = compileFilterGroups([{ filter }])[0];
  let matches = 0;
  for (const card of cards) if (cardMatchesCompiled(card, compiled)) matches++;

  const caughtBy: TilePreview['caughtBy'] = [];
  if (lands < matches) {
    for (const b of result.binders) {
      if (b.def.id === DRAFT_ID) continue;
      let count = 0;
      for (const section of b.sections) {
        for (const c of section.cards) {
          if (cardMatchesCompiled(c, compiled)) count++;
        }
      }
      if (count > 0) caughtBy.push({ binderName: b.def.name, count });
    }
    caughtBy.sort((a, b) => b.count - a.count || a.binderName.localeCompare(b.binderName));
  }

  return { matches, lands, pages, caughtBy };
}

/** One tile's inputs, keyed so the hook can tell which tiles actually need
 *  recomputing (a color pick changes ONE tile, not all ten). */
export interface PreviewRequest {
  key: string;
  filter: BinderFilter;
  sorts: SortEntry[];
}

function requestSignature(r: PreviewRequest): string {
  return JSON.stringify([r.filter, r.sorts]);
}

function scheduleIdle(fn: () => void): () => void {
  const w = window as typeof window & {
    requestIdleCallback?: (cb: () => void) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(fn);
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 0);
  return () => window.clearTimeout(id);
}

/**
 * Computes every chooser tile's `TilePreview` off the main render, one at a
 * time on the idle queue, so opening a dialog with a dozen tiles against an
 * 11k-card collection never janks the open animation. Results are cached by
 * request signature across renders (a `useRef`, not state) so switching the
 * one-color pick back to a color already computed this session is instant,
 * and an unrelated re-render never redoes work every other tile already has
 * an answer for.
 */
export function useChooserPreviews(
  requests: PreviewRequest[],
  cards: EnrichedCard[],
  binders: BinderDef[],
  layout: Pick<BinderLayoutInputs, 'allocatedCopyIds' | 'setMap'>
): Map<string, TilePreview | 'loading'> {
  // The persistent cross-render cache. Read and written ONLY from inside the
  // effect below (never during render) — a ref read during render can't be
  // relied on to trigger a re-render when it changes, which is exactly the
  // bug this hook had before: the cache filled in on schedule while the
  // rendered Map never rebuilt from it. `results` (real state) is what
  // render actually reads.
  const cache = useRef(new Map<string, { sig: string; preview: TilePreview }>());
  const deps = useRef<{
    cards: EnrichedCard[];
    binders: BinderDef[];
    layout: typeof layout;
  } | null>(null);
  const [results, setResults] = useState<Map<string, TilePreview | 'loading'>>(new Map());

  // Stable across renders that don't actually change what's asked for, so the
  // effect below doesn't requeue on every keystroke/hover in the dialog.
  const sig = requests.map((r) => `${r.key}:${requestSignature(r)}`).join('|');

  useEffect(() => {
    let cancelled = false;
    let cancelIdle: (() => void) | undefined;
    // A request's signature is only its filter + sorts — it can't see that
    // `cards` itself changed underneath it (tags finishing decoration, a
    // sibling binder edited elsewhere). Any identity change on the shared
    // inputs invalidates every cached answer rather than just the ones whose
    // own signature moved.
    if (
      deps.current &&
      (deps.current.cards !== cards ||
        deps.current.binders !== binders ||
        deps.current.layout !== layout)
    ) {
      cache.current.clear();
    }
    deps.current = { cards, binders, layout };

    const buildResults = (): Map<string, TilePreview | 'loading'> => {
      const out = new Map<string, TilePreview | 'loading'>();
      for (const r of requests) {
        const hit = cache.current.get(r.key);
        out.set(r.key, hit && hit.sig === requestSignature(r) ? hit.preview : 'loading');
      }
      return out;
    };
    // Show whatever the cache already answers immediately (a color switched
    // back to one already computed this session), with the rest 'loading'.
    setResults(buildResults());

    const pending = requests.filter((r) => cache.current.get(r.key)?.sig !== requestSignature(r));
    function step(queue: PreviewRequest[]) {
      if (cancelled || queue.length === 0) return;
      const [next, ...rest] = queue;
      const preview = previewTile(next.filter, next.sorts, cards, binders, layout);
      cache.current.set(next.key, { sig: requestSignature(next), preview });
      if (!cancelled) setResults(buildResults());
      cancelIdle = scheduleIdle(() => step(rest));
    }
    if (pending.length > 0) cancelIdle = scheduleIdle(() => step(pending));
    return () => {
      cancelled = true;
      cancelIdle?.();
    };
    // `sig` captures every input `previewTile` reads; `cards`/`binders`/`layout`
    // are included so a fresh collection/binder list invalidates correctly even
    // though `sig` alone would already change for those too (filters don't).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, cards, binders, layout]);

  return results;
}
