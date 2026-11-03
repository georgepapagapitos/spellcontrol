// Shared safety rails for the scanner reference-data ingests (hash-ingest,
// embedding-ingest).
//
// Scryfall retires the art_crop JPEG on 2027-01-01 and replaces it with an
// `art` WebP. A key that goes missing doesn't 404, it reads as `undefined`,
// so every card is skipped and the ingest would "succeed" with a near-empty
// file. scanner-ingest.yml opens an auto-merging PR for whatever the ingest
// writes, so that file would ship. The floor below makes the ingest fail
// loudly instead, and the old file stays in place.

import * as fs from 'node:fs/promises';

/** A new file may hold at least this share of the previous file's records. */
export const MIN_RETAINED_RATIO = 0.9;

/**
 * Record count of the committed files as of 2026-11-01 (both bins hold the
 * same unique_artwork set). Used only when there is no readable previous file,
 * e.g. a fresh checkout without the LFS blob. Raise it when the corpus grows.
 */
export const BASELINE_RECORD_COUNT = 55_725;

interface ImageUrisLike {
  art?: unknown;
  art_crop?: unknown;
}
interface ArtCard {
  image_uris?: ImageUrisLike | null;
  card_faces?: Array<{ image_uris?: ImageUrisLike | null }> | null;
}

function pick(uris: ImageUrisLike | null | undefined): string | null {
  // `art` is the WebP key that outlives the 2027-01-01 art_crop JPEG removal.
  for (const v of [uris?.art, uris?.art_crop]) {
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

/** A printing's art image URL: `art` (WebP) first, then legacy `art_crop`; face 0 for double-faced cards. */
export function extractArtUrl(card: ArtCard): string | null {
  // Double-faced cards put image_uris on each face. We take face 0 (front)
  // as canonical — back-side hashing is a later enhancement.
  return pick(card.image_uris) ?? pick(card.card_faces?.[0]?.image_uris);
}

/** Record count from a packed scanner binary's header (uint32 LE at byte 8), or null if unreadable. */
export async function readRecordCount(filePath: string): Promise<number | null> {
  let fh: fs.FileHandle | undefined;
  try {
    fh = await fs.open(filePath, 'r');
    const header = Buffer.alloc(16);
    const { bytesRead } = await fh.read(header, 0, 16, 0);
    // Short read or wrong magic ("SC1H" hashes / "SC1E" embeddings): a missing
    // blob or a Git LFS pointer file. No usable count.
    if (bytesRead < 16) return null;
    const magic = header.toString('latin1', 0, 4);
    if (magic !== 'SC1H' && magic !== 'SC1E') return null;
    return header.readUInt32LE(8);
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

/**
 * Throw if `newCount` is under 90% of the previous file's record count (or of
 * {@link BASELINE_RECORD_COUNT} when there is no previous). Call before the
 * rename so a refused run leaves the old file untouched. A `--limit` run is a
 * deliberate truncation, so it skips the floor.
 */
export async function assertWriteFloor(opts: {
  label: string;
  outPath: string;
  newCount: number;
  limited?: boolean;
}): Promise<void> {
  if (opts.limited) return;
  const previous = await readRecordCount(opts.outPath);
  const reference = previous ?? BASELINE_RECORD_COUNT;
  const min = Math.ceil(reference * MIN_RETAINED_RATIO);
  if (opts.newCount >= min) return;
  throw new Error(
    `[${opts.label}] refusing to replace ${opts.outPath}: wrote ${opts.newCount} records, ` +
      `under ${Math.round(MIN_RETAINED_RATIO * 100)}% of ${reference} ` +
      `(${previous === null ? 'committed baseline' : 'previous file'}; minimum ${min}). ` +
      `Scryfall may have removed an image key; check extractArtUrl. The existing file was left in place.`
  );
}

export interface ArtFetchOptions {
  /** Total attempts, first try included. Default 3. */
  maxAttempts?: number;
  /** Delay before retry n is `backoffMs * 2^(n-1)`. Default 500; tests pass 0. */
  backoffMs?: number;
}

/**
 * One art image's bytes, retrying transient failures (network error, timeout,
 * 429, 5xx) a bounded number of times. Any other non-OK status returns null,
 * as before, so the caller skips the card. The last transient failure throws,
 * which the ingest loop already counts as a skip.
 */
export async function fetchArtBytes(
  url: string,
  userAgent: string,
  timeoutMs: number,
  opts: ArtFetchOptions = {}
): Promise<ArrayBuffer | null> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const backoffMs = opts.backoffMs ?? 500;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return await res.arrayBuffer();
      if (res.status !== 429 && res.status < 500) return null;
      throw new Error(`art fetch returned ${res.status}`);
    } catch (err) {
      if (attempt >= maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, backoffMs * 2 ** (attempt - 1)));
    }
  }
}
