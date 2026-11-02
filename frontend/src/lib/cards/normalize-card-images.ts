import { normalizeImageUris } from '@spellcontrol/deck-metrics';

/**
 * Scryfall retires the small / large / border_crop / art_crop JPEGs on
 * 2027-01-01 (E1088). Every card that enters the app from Scryfall, the
 * backend or a persisted store passes through here, so the rest of the code
 * keeps reading `image_uris.small | normal | large | art_crop` and gets WebP
 * URLs. The CDN's size segments live in ONE place, the shared leaf in
 * `@spellcontrol/deck-metrics`; this file only walks the card shapes.
 */

type Json = Record<string, unknown>;

function isObject(x: unknown): x is Json {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/**
 * `value` with the `image_uris` of every card it holds normalized: a card, its
 * `card_faces`, a list's `data`, or an array of any of those. Returns the same
 * reference when nothing needed changing, and passes anything else through.
 */
export function normalizeCardImages<T>(value: T): T {
  if (Array.isArray(value)) {
    let out: unknown[] | undefined;
    value.forEach((v, i) => {
      const next = normalizeCardImages(v);
      if (next !== v) (out ??= value.slice())[i] = next;
    });
    return (out ?? value) as T;
  }
  if (!isObject(value)) return value;
  let out: Json | undefined;
  for (const key of ['image_uris', 'card_faces', 'data'] as const) {
    const v = value[key];
    if (v === undefined || v === null) continue;
    const next = key === 'image_uris' ? normalizeImageUris(v) : normalizeCardImages(v);
    if (next !== v) (out ??= { ...value })[key] = next;
  }
  return (out ?? value) as T;
}
