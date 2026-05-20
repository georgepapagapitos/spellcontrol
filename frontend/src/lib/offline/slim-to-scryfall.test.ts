import { describe, it, expect } from 'vitest';
import { slimToScryfall } from './slim-to-scryfall';
import type { SlimCard } from './types';

describe('slimToScryfall', () => {
  it('inflates the basic field set onto a ScryfallCard-shaped object', () => {
    const slim: SlimCard = {
      oracleId: 'oracle-abc',
      scryfallId: 'scry-abc',
      name: 'Solemn Simulacrum',
      manaCost: '{4}',
      cmc: 4,
      typeLine: 'Artifact Creature — Golem',
      oracleText: 'When this creature enters, you may search your library...',
      colors: [],
      colorIdentity: [],
      keywords: [],
      legalities: { commander: 'legal' },
      set: 'mh3',
      setName: 'Modern Horizons 3',
      collectorNumber: '123',
      imageNormal: 'https://example/normal.jpg',
      usdPrice: '1.23',
    };
    const card = slimToScryfall(slim);
    expect(card.id).toBe('scry-abc');
    expect(card.oracle_id).toBe('oracle-abc');
    expect(card.name).toBe('Solemn Simulacrum');
    expect(card.cmc).toBe(4);
    expect(card.legalities.commander).toBe('legal');
    expect(card.prices.usd).toBe('1.23');
    expect(card.image_uris?.normal).toBe('https://example/normal.jpg');
  });

  it('omits image_uris when no image data is present (deck builder gracefully degrades)', () => {
    const slim: SlimCard = {
      oracleId: 'o',
      scryfallId: 's',
      name: 'No Image',
      cmc: 0,
      typeLine: 'Token',
      colors: [],
      colorIdentity: [],
      keywords: [],
      legalities: {},
      set: 'tok',
    };
    expect(slimToScryfall(slim).image_uris).toBeUndefined();
  });

  it('passes through DFC faces', () => {
    const slim: SlimCard = {
      oracleId: 'o',
      scryfallId: 's',
      name: 'Front // Back',
      cmc: 2,
      typeLine: 'Instant // Land',
      colors: ['U'],
      colorIdentity: ['U'],
      keywords: [],
      legalities: { commander: 'legal' },
      set: 'znr',
      layout: 'modal_dfc',
      faces: [
        { name: 'Front', typeLine: 'Instant', oracleText: 'Counter target spell.' },
        { name: 'Back', typeLine: 'Land', oracleText: 'Enters tapped.' },
      ],
    };
    const card = slimToScryfall(slim);
    expect(card.card_faces).toHaveLength(2);
    expect(card.card_faces?.[0].name).toBe('Front');
    expect(card.card_faces?.[1].name).toBe('Back');
  });
});
