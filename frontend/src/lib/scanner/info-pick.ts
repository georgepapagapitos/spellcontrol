// Scanner: after the matcher names a printing, choose among the printings that
// share its art by reading the scan's info line (see info-strip.ts).
//
// Lives behind the scanner's lazy boundary (CardScanner imports it), so a
// visitor who never taps Scan downloads none of it. Every failure path hands
// back the matcher's own card: a refinement that can't finish is no worse than
// the behavior before it existed.

import { fetchPrintings } from '@/lib/api';
import { logger } from '@/lib/util/logger';
import type { ScryfallCard } from '@/deck-builder/types';
import { WARP_HEIGHT, WARP_WIDTH } from './detect';
import { pickByInfoStrip, type GrayImage } from './info-strip';

/** More same-art printings than this and the field is too wide to trust. */
export const MAX_SAME_ART = 12;
/** The whole refinement may take this long before the matcher's card stands. */
const REFINE_BUDGET_MS = 4_000;

const DOUBLE_FACED = new Set(['transform', 'modal_dfc', 'double_faced_token', 'reversible_card']);

/**
 * Cards whose printings are never worth fetching: a basic land has hundreds of
 * printings, and a double-faced card carries its illustration per face. Checked
 * before the lookup so a scan of a basic never pulls its whole print run
 * through the backend.
 */
function neverRefined(card: ScryfallCard): boolean {
  return (
    /\bBasic\b/.test(card.type_line ?? '') ||
    (card.layout !== undefined && DOUBLE_FACED.has(card.layout))
  );
}

/**
 * The printings that share `card`'s illustration, `card` included, each with a
 * 488x680 `normal` image. Fewer than two means there is nothing to choose
 * between. Basic lands and double-faced cards are left alone: a basic has
 * hundreds of printings, and a double-faced card carries its illustration per
 * face.
 */
export function sameArtPrintings(card: ScryfallCard, printings: ScryfallCard[]): ScryfallCard[] {
  const ill = card.illustration_id;
  if (!ill || neverRefined(card)) return [];
  const same = printings.filter((p) => p.illustration_id === ill && p.image_uris?.normal);
  if (!same.some((p) => p.id === card.id) && card.image_uris?.normal) same.push(card);
  return same.length >= 2 && same.length <= MAX_SAME_ART ? same : [];
}

export interface RefineDeps {
  fetchPrintings: (name: string, set?: string, oracleId?: string) => Promise<ScryfallCard[]>;
  /** A printing's `normal` image as 488x680 luminance. */
  loadGray: (url: string) => Promise<GrayImage>;
}

/** Luminance of a canvas. */
export function canvasToGray(canvas: HTMLCanvasElement): GrayImage {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
  }
  return { data: gray, width, height };
}

async function loadGrayFromUrl(url: string): Promise<GrayImage> {
  const res = await fetch(url, { signal: AbortSignal.timeout(REFINE_BUDGET_MS) });
  if (!res.ok) throw new Error('reference image unavailable');
  const bitmap = await createImageBitmap(await res.blob());
  try {
    const canvas = document.createElement('canvas');
    canvas.width = WARP_WIDTH;
    canvas.height = WARP_HEIGHT;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0, WARP_WIDTH, WARP_HEIGHT);
    return canvasToGray(canvas);
  } finally {
    bitmap.close();
  }
}

/**
 * A scanning session meets the same cards again and again, and the printings
 * route is rate limited, so both lookups are remembered for the session. A
 * failed lookup is forgotten so the next scan retries it. Bounded (least
 * recently used goes first): a decoded reference image is about 330 KB, and a
 * bulk session must not grow without limit on a phone.
 */
export function memoize<A, T>(fn: (key: string, ...rest: A[]) => Promise<T>, max: number) {
  const seen = new Map<string, Promise<T>>();
  return (key: string, ...rest: A[]): Promise<T> => {
    let hit = seen.get(key);
    if (hit) {
      seen.delete(key);
      seen.set(key, hit);
      return hit;
    }
    const pending = fn(key, ...rest);
    hit = pending;
    seen.set(key, pending);
    pending.catch(() => {
      if (seen.get(key) === pending) seen.delete(key);
    });
    if (seen.size > max) seen.delete(seen.keys().next().value as string);
    return pending;
  };
}

/** Reference images kept: 40 x ~330 KB. Printings are small objects. */
const GRAY_CACHE_MAX = 40;
const PRINTINGS_CACHE_MAX = 100;

const printingsByName = memoize(
  (name: string, set?: string, oracleId?: string) => fetchPrintings(name, set, oracleId),
  PRINTINGS_CACHE_MAX
);
const defaultDeps: RefineDeps = {
  fetchPrintings: (name, set, oracleId) => printingsByName(oracleId ?? name, set, oracleId),
  loadGray: memoize(loadGrayFromUrl, GRAY_CACHE_MAX),
};

/**
 * The printing the scan's info line agrees with, or `card` itself when it
 * cannot tell, there is nothing to choose between, or anything fails.
 */
export async function refinePrinting(
  card: ScryfallCard,
  scan: GrayImage,
  deps: RefineDeps = defaultDeps
): Promise<ScryfallCard> {
  if (!card.illustration_id || neverRefined(card)) return card;
  const work = async (): Promise<ScryfallCard> => {
    const candidates = sameArtPrintings(
      card,
      await deps.fetchPrintings(card.name, undefined, card.oracle_id)
    );
    if (candidates.length === 0) return card;
    const refs = await Promise.all(candidates.map((c) => deps.loadGray(c.image_uris!.normal)));
    const idx = pickByInfoStrip(scan, refs);
    return idx === null ? card : candidates[idx];
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<ScryfallCard>((resolve) => {
    timer = setTimeout(() => resolve(card), REFINE_BUDGET_MS);
  });
  try {
    return await Promise.race([work(), budget]);
  } catch (err) {
    logger.debug(
      `[scanner] printing refinement failed: ${err instanceof Error ? err.message : err}`
    );
    return card;
  } finally {
    clearTimeout(timer);
  }
}
