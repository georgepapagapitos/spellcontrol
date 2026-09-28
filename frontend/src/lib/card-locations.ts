import { useMemo } from 'react';
import type { MaterializedBinder } from '../types';
import { materializeBinders } from './materialize';
import { formatBinderPages } from './import-routing';
import { useBinderLayoutInputs, type BinderLayoutInputs } from './use-binder-layout-inputs';
import { volumesFor, pageVolume } from './binder-volumes';

/** Where a card physically sits: which binder, which page, which pocket. */
export interface CardLocation {
  binderId: string;
  binderName: string;
  binderColor?: string;
  /** 1-based page number within the binder, as shown in the binder view. */
  pageNum: number;
  /** 1-based pocket on that page, counted left to right, top to bottom. */
  slot: number;
  /** 1-based physical book number — present only when the binder is over its
   *  fixed capacity and so reads as more than one volume. Absent on a binder
   *  that fits in one book, so callers never say "Vol 1" for a binder that
   *  will never have a "Vol 2". */
  volume?: number;
}

export interface CardLocationIndex {
  /** Every copy filed in a binder, by `copyId`. */
  byCopyId: Map<string, CardLocation>;
  /** The first copy of each card, by `oracleId`, in binder priority order. */
  byOracleId: Map<string, CardLocation>;
}

const EMPTY_INDEX: CardLocationIndex = { byCopyId: new Map(), byOracleId: new Map() };

/**
 * Reads every filled pocket out of an already-materialized binder list.
 *
 * `binders` must be in priority order (materialize's own output is), so
 * `byOracleId` keeps the FIRST binder's copy, mirroring the routing engine's
 * first-match-wins rule.
 */
export function indexCardLocations(binders: MaterializedBinder[]): CardLocationIndex {
  const byCopyId = new Map<string, CardLocation>();
  const byOracleId = new Map<string, CardLocation>();
  for (const b of binders) {
    // `b.sections` here comes from an unfiltered materialize pass (see
    // `buildCardLocationIndex`), which is exactly what `volumesFor` requires.
    const volumes = volumesFor(b);
    for (const section of b.sections) {
      for (const page of section.pages) {
        const volume = pageVolume(volumes, page.pageNum);
        page.slots.forEach((card, i) => {
          if (!card) return;
          const at: CardLocation = {
            binderId: b.def.id,
            binderName: b.def.name,
            binderColor: b.def.color,
            pageNum: page.pageNum,
            slot: i + 1,
            ...(volume !== undefined ? { volume } : {}),
          };
          if (card.copyId) byCopyId.set(card.copyId, at);
          if (card.oracleId && !byOracleId.has(card.oracleId)) byOracleId.set(card.oracleId, at);
        });
      }
    }
  }
  return { byCopyId, byOracleId };
}

/**
 * Where every card sits, laid out from `useBinderLayoutInputs()`, the chain
 * BinderPage renders from. Taking the inputs as one object (rather than raw
 * cards + defs) is the point: a caller cannot hand this a collection that
 * skipped the tag, Secret Lair or release-date decoration, or the deck
 * allocations, and so cannot report a page the binder view disagrees with.
 */
export function buildCardLocationIndex(layout: BinderLayoutInputs): CardLocationIndex {
  if (layout.cards.length === 0 || layout.binders.length === 0) return EMPTY_INDEX;
  const { binders } = materializeBinders(layout.cards, layout.binders, {
    search: '',
    allocatedCopyIds: layout.allocatedCopyIds,
    setMap: layout.setMap,
  });
  return indexCardLocations(binders);
}

/**
 * Hook form of {@link buildCardLocationIndex}. Pass `enabled: false` on a
 * surface that only sometimes needs locations, so it doesn't materialize the
 * whole collection for nothing. Call it once per surface and pass the index
 * down, never per row.
 */
export function useCardLocations(enabled = true): CardLocationIndex {
  const layout = useBinderLayoutInputs();
  return useMemo(() => (enabled ? buildCardLocationIndex(layout) : EMPTY_INDEX), [enabled, layout]);
}

/**
 * One way to say where a card is, everywhere: "Mana rocks · p. 3 · slot 5",
 * or "Mana rocks · Vol 2 · p. 45 · slot 3" once the binder outgrows its
 * capacity and reads as more than one book. `binder: false` drops the name
 * for a surface that already shows it (a row under its binder's heading, or
 * next to a binder pill). Leave `slot` out when the pocket isn't known for
 * THIS copy (a location looked up by card rather than by copy): "Mana rocks ·
 * p. 3" is true, a borrowed slot is not. Leave `volume` out entirely for a
 * binder that fits in one book — never print "Vol 1" for a binder that will
 * never have a "Vol 2".
 */
export function formatLocation(
  at: Pick<CardLocation, 'binderName' | 'pageNum'> & { slot?: number; volume?: number },
  { binder = true }: { binder?: boolean } = {}
): string {
  const page = formatBinderPages([at.pageNum]);
  const withVolume = at.volume ? `Vol ${at.volume} · ${page}` : page;
  const where = at.slot ? `${withVolume} · slot ${at.slot}` : withVolume;
  return binder ? `${at.binderName} · ${where}` : where;
}

/**
 * The same idea for a pile of copies (a pull-list row): one pocket reads like
 * {@link formatLocation}, a run on one page reads "p. 3 · slots 4–6", and a
 * pile that crosses pages falls back to its pages, "pp. 3–4". `volume`, when
 * given, is the book every spot in the pile shares (a pile that crosses
 * volumes is a contradiction in a first-match-wins binder, since a volume is
 * itself a contiguous page range).
 */
export function formatLocationSpan(
  spots: Pick<CardLocation, 'pageNum' | 'slot'>[],
  { volume }: { volume?: number } = {}
): string {
  if (spots.length === 0) return '';
  const prefix = volume ? `Vol ${volume} · ` : '';
  const pages = [...new Set(spots.map((s) => s.pageNum))];
  if (pages.length > 1) return `${prefix}${formatBinderPages(pages)}`;
  const slots = [...new Set(spots.map((s) => s.slot))].sort((a, b) => a - b);
  const first = slots[0];
  const last = slots[slots.length - 1];
  const slotText =
    slots.length === 1
      ? `slot ${first}`
      : last - first === slots.length - 1
        ? `slots ${first}–${last}`
        : `slots ${slots.join(', ')}`;
  return `${prefix}${formatBinderPages(pages)} · ${slotText}`;
}
