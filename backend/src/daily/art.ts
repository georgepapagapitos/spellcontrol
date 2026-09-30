import sharp from 'sharp';
import { SCRYFALL_USER_AGENT } from '../scryfall';

/** Blur sigma per art level, 0 (unrecognizable) to 5 (nearly clear). */
export const BLUR_SIGMA = [28, 20, 14, 9, 5, 3] as const;
const WIDTH = 480;
const FETCH_TIMEOUT_MS = 8000;

interface DayArt {
  date: string;
  source: Promise<Buffer>;
  levels: Map<number, Promise<Buffer>>;
}

let cache: DayArt | null = null;

/** Drop the in-memory art (tests). */
export function resetArtCache(): void {
  cache = null;
}

async function fetchSource(url: string): Promise<Buffer> {
  // Scryfall's image CDN answers 400 to a request with no User-Agent (Node's
  // fetch sends none); found by running the endpoint against the real CDN.
  const res = await fetch(url, {
    headers: { 'User-Agent': SCRYFALL_USER_AGENT, Accept: 'image/*' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`art source HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * The day's art at a blur level as a JPEG. The source and each level are kept
 * in memory for the current date only; a failed fetch is not cached.
 */
export function blurredArt(date: string, artUrl: string, level: number): Promise<Buffer> {
  if (!cache || cache.date !== date) {
    cache = { date, source: fetchSource(artUrl), levels: new Map() };
    const mine = cache;
    mine.source.catch(() => {
      if (cache === mine) cache = null;
    });
  }
  const day = cache;
  let out = day.levels.get(level);
  if (!out) {
    out = day.source.then((src) =>
      sharp(src).resize({ width: WIDTH }).blur(BLUR_SIGMA[level]!).jpeg({ quality: 70 }).toBuffer()
    );
    day.levels.set(level, out);
    out.catch(() => day.levels.delete(level));
  }
  return out;
}
