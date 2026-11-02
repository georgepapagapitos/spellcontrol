// ── Scryfall card image URLs ────────────────────────────────────────────────
//
// Scryfall retires the small / large / border_crop / art_crop JPEGs on
// 2027-01-01 and renames the normal JPEG to `jpeg`; the WebP keys (thumb, grid,
// display, crop, art) are live now. A WebP URL is the legacy URL with the size
// segment renamed and the extension swapped, query stamp untouched:
//
//   cards.scryfall.io/small/front/f/c/<id>.jpg?1793021181
//   cards.scryfall.io/thumb/front/f/c/<id>.webp?1793021181
//
// This is the ONE place that knows the CDN's size segments. Everything else
// calls these pure functions, so persisted URLs (IndexedDB, synced rows, the
// publications table) are rewritten on read, never by a data migration.

/** Legacy image_uris key -> the WebP key that replaces it. */
const LEGACY_TO_MODERN = {
  small: 'thumb',
  normal: 'grid',
  large: 'display',
  border_crop: 'crop',
  art_crop: 'art',
} as const;

type LegacyKey = keyof typeof LEGACY_TO_MODERN;
type ModernKey = (typeof LEGACY_TO_MODERN)[LegacyKey];

const LEGACY_KEYS = Object.keys(LEGACY_TO_MODERN) as LegacyKey[];

const MODERN_TO_LEGACY: Record<ModernKey, LegacyKey> = {
  thumb: 'small',
  grid: 'normal',
  display: 'large',
  crop: 'border_crop',
  art: 'art_crop',
};

const HOST = 'https://cards.scryfall.io/';
const LEGACY_URL =
  /^https:\/\/cards\.scryfall\.io\/(small|normal|large|border_crop|art_crop)\/(.+)\.jpg(\?.*)?$/;
const MODERN_URL =
  /^https:\/\/cards\.scryfall\.io\/(thumb|grid|display|crop|art)\/(.+)\.webp(\?.*)?$/;

/**
 * The WebP URL for a legacy Scryfall JPEG URL. Idempotent; a URL that is
 * already WebP, a PNG, or not on the Scryfall card CDN comes back unchanged.
 * The `?<stamp>` query is kept so cache-busting survives.
 */
export function modernScryfallImage(url: string): string;
export function modernScryfallImage<T extends string | null | undefined>(url: T): T;
export function modernScryfallImage(url: string | null | undefined): string | null | undefined {
  if (!url) return url;
  const m = LEGACY_URL.exec(url);
  if (!m) return url;
  return `${HOST}${LEGACY_TO_MODERN[m[1] as LegacyKey]}/${m[2]}.webp${m[3] ?? ''}`;
}

/**
 * A JPEG URL that still exists after 2027-01-01, for contexts that cannot take
 * WebP (link-preview crawlers). Both generations map to the `/normal/…jpg` file
 * (the `jpeg` key, which Scryfall keeps): a WebP-generation URL, and a legacy
 * small / large / border_crop / art_crop JPEG, which is what stored
 * `deck_publications.og_art_crop` rows still hold and which 404s after the
 * cutoff. A legacy `normal` URL and any other URL come back unchanged.
 */
export function scryfallJpegImage<T extends string | null | undefined>(url: T): T {
  if (!url) return url;
  const m = MODERN_URL.exec(url) ?? LEGACY_URL.exec(url);
  if (!m) return url;
  return `${HOST}normal/${m[2]}.jpg${m[3] ?? ''}` as T;
}

/** True for a URL on the Scryfall card CDN whose size segment is a legacy one. */
export function isLegacyScryfallImage(url: unknown): boolean {
  return typeof url === 'string' && LEGACY_URL.test(url);
}

type Uris = Record<string, unknown>;

function isRecord(x: unknown): x is Uris {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/**
 * `uris` with every absent legacy key (small, normal, large, border_crop,
 * art_crop) filled from its WebP counterpart (thumb, grid, display, crop,
 * art). Keys that are present are left alone, so a card Scryfall still serves
 * both ways is unchanged. Returns the same reference when there is nothing to
 * fill; non-objects pass through.
 */
export function withLegacyImageKeys<T>(uris: T): T {
  if (!isRecord(uris)) return uris;
  let out: Uris | undefined;
  for (const legacy of LEGACY_KEYS) {
    if (uris[legacy]) continue;
    const modern = uris[LEGACY_TO_MODERN[legacy]];
    if (typeof modern !== 'string' || !modern) continue;
    out ??= { ...uris };
    out[legacy] = modern;
  }
  return (out ?? uris) as T;
}

/**
 * The reverse of {@link withLegacyImageKeys}: `uris` with every absent WebP key
 * filled from its legacy JPEG key, rewritten to the WebP URL.
 */
export function withModernImageKeys<T>(uris: T): T {
  if (!isRecord(uris)) return uris;
  let out: Uris | undefined;
  for (const [modernKey, legacy] of Object.entries(MODERN_TO_LEGACY)) {
    if (uris[modernKey]) continue;
    const old = uris[legacy];
    if (typeof old !== 'string' || !old) continue;
    out ??= { ...uris };
    out[modernKey] = modernScryfallImage(old);
  }
  return (out ?? uris) as T;
}

/**
 * The shape the apps read: legacy keys always present and always WebP. Fills a
 * missing legacy key from its WebP counterpart, then rewrites any legacy JPEG
 * URL to WebP. Other keys (png, jpeg, thumb, …) are kept as they are.
 */
export function normalizeImageUris<T>(uris: T): T {
  if (!isRecord(uris)) return uris;
  const filled = withLegacyImageKeys(uris);
  let out: Uris | undefined;
  for (const legacy of LEGACY_KEYS) {
    const v = filled[legacy];
    if (typeof v !== 'string') continue;
    const next = modernScryfallImage(v);
    if (next === v) continue;
    out ??= { ...filled };
    out[legacy] = next;
  }
  return (out ?? filled) as T;
}
