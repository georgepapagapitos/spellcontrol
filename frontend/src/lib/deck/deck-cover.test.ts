import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { deckCoverArt } from './deck-cover';

const card = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, type_line: 'Creature', ...extra }) as unknown as ScryfallCard;

describe('deckCoverArt', () => {
  it('reads the art crop of the picked card', () => {
    const cmdr = card('Jace', { image_uris: { art_crop: 'https://c/art_crop/jace.jpg' } });
    expect(deckCoverArt({ commander: cmdr, cards: [] })).toBe('https://c/art_crop/jace.jpg');
  });

  it('derives a crop from an offline card that carries only the normal scan', () => {
    const offline = card('Delver', {
      card_faces: [{ image_uris: { normal: 'https://c/normal/delver.jpg' } }],
    });
    expect(deckCoverArt({ cards: [{ card: offline }] })).toBe('https://c/art_crop/delver.jpg');
  });

  it('is undefined for a deck with no art', () => {
    expect(deckCoverArt({ commander: null, cards: [{ card: card('Bare') }] })).toBeUndefined();
  });
});
