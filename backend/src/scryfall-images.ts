import { modernScryfallImage, normalizeImageUris } from '@spellcontrol/deck-metrics';

/**
 * Scryfall retires the small / large / border_crop / art_crop JPEGs on
 * 2027-01-01. Every Scryfall card payload enters the backend through
 * {@link normalizeCardImages}, so the rest of the code keeps reading
 * `image_uris.small | normal | large | art_crop` and gets the WebP URL, whether
 * Scryfall still sends the old keys or only the new ones (thumb, grid, display,
 * crop, art). The size-segment knowledge lives in `@spellcontrol/deck-metrics`.
 */

interface WithImages {
  image_uris?: unknown;
  card_faces?: Array<{ image_uris?: unknown } | null> | null;
}

/** Normalizes `image_uris` on the card and each face, in place. Returns the card. */
export function normalizeCardImages<T>(card: T): T {
  const c = card as WithImages | null | undefined;
  if (!c || typeof c !== 'object') return card;
  if (c.image_uris) c.image_uris = normalizeImageUris(c.image_uris);
  if (Array.isArray(c.card_faces)) {
    for (const face of c.card_faces) {
      if (face && face.image_uris) face.image_uris = normalizeImageUris(face.image_uris);
    }
  }
  return card;
}

/** {@link normalizeCardImages} over a list (an API page, a cache read). */
export function normalizeCardsImages<T>(cards: T[]): T[] {
  for (const card of cards) normalizeCardImages(card);
  return cards;
}

/** A stored image URL column (avatar, publication art) rewritten on read. */
export function storedImageUrl(url: string | null | undefined): string | null {
  return url ? modernScryfallImage(url) : null;
}

/**
 * Stored `deck_feedback.suggestions` rewritten on read: each suggestion's
 * `imageUrl`, and the card blob an "add" carries along.
 */
export function modernFeedbackSuggestions(suggestions: unknown): unknown {
  if (!Array.isArray(suggestions)) return suggestions;
  return suggestions.map((s) => {
    if (!s || typeof s !== 'object') return s;
    const rec = s as { imageUrl?: unknown; card?: unknown };
    const imageUrl =
      typeof rec.imageUrl === 'string' ? modernScryfallImage(rec.imageUrl) : rec.imageUrl;
    const card =
      rec.card && typeof rec.card === 'object'
        ? normalizeCardImages(structuredClone(rec.card))
        : rec.card;
    return { ...rec, imageUrl, card };
  });
}
