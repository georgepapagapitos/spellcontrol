import type { DeckFormat } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';

/**
 * The `?format=` query value /decks/new and /decks/new/generate share, so the
 * picked format survives a hop between the two pages, a reload and Back.
 * Anything that isn't a known format reads as absent, never as a guess.
 */
export function parseDeckFormat(value: string | null | undefined): DeckFormat | null {
  return value && Object.hasOwn(DECK_FORMAT_CONFIGS, value) ? (value as DeckFormat) : null;
}
