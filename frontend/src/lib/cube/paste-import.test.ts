import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { DeckImportResponse } from '@/types';

const importDeckText = vi.fn();
vi.mock('@/lib/api', () => ({ importDeckText: (t: string) => importDeckText(t) }));

import { cubeFromResolvedCards, importPastedCube, stripDraftmancerStructure } from './paste-import';
import { CubeImportError } from './import';

// The example on https://draftmancer.com/cubeformat.html, plus the card-line
// forms the page documents.
const DRAFTMANCER_FIXTURE = `[Settings]
{
	"withReplacement": true
}
# This sheet contains all the cards because this is just an example of how to use comments!
[DefaultSheet]
Lightning Bolt
8 Forest (ANA) 60
Incubation Druid
`;

const card = (name: string, oracle: string, over: Partial<ScryfallCard> = {}): ScryfallCard =>
  ({
    id: oracle,
    oracle_id: oracle,
    name,
    cmc: 1,
    type_line: 'Instant',
    colors: ['R'],
    image_uris: { small: `https://img/${oracle}.jpg` },
    ...over,
  }) as ScryfallCard;

const response = (over: Partial<DeckImportResponse>): DeckImportResponse => ({
  commander: null,
  companion: null,
  cards: [],
  unresolvedNames: [],
  fetchErrors: [],
  detectedFormat: 'plain',
  cardCount: 0,
  ...over,
});

beforeEach(() => importDeckText.mockReset());

describe('stripDraftmancerStructure', () => {
  it('drops Settings, JSON, comments and headers; keeps card lines', () => {
    expect(stripDraftmancerStructure(DRAFTMANCER_FIXTURE).trim().split('\n')).toEqual([
      'Lightning Bolt',
      '8 Forest (ANA) 60',
      'Incubation Druid',
    ]);
  });

  it('leaves a plain list and a CSV untouched', () => {
    const csv = 'name,CMC,Type\nSol Ring,1,Artifact';
    expect(stripDraftmancerStructure(csv)).toBe(csv);
    expect(stripDraftmancerStructure('Sol Ring\nBolt')).toBe('Sol Ring\nBolt');
  });
});

describe('cubeFromResolvedCards', () => {
  it('keeps one entry per distinct card (an 8x line expands server-side)', () => {
    const forest = card('Forest', 'f', { type_line: 'Basic Land — Forest', colors: [] });
    const cube = cubeFromResolvedCards([forest, forest, card('Lightning Bolt', 'b')]);
    expect(cube.cards.map((c) => c.name)).toEqual(['Forest', 'Lightning Bolt']);
    expect(cube.cardCount).toBe(2);
    expect(cube.cards[1]).toMatchObject({
      oracleId: 'b',
      typeLine: 'Instant',
      colors: ['R'],
      image: 'https://img/b.jpg',
    });
  });

  it('falls back to the front face for a double-faced card', () => {
    const dfc = card('Delver // Insectile Aberration', 'd', {
      type_line: undefined,
      colors: undefined,
      image_uris: undefined,
      card_faces: [
        { type_line: 'Creature — Human Wizard', colors: ['U'], image_uris: { small: 'f.jpg' } },
      ],
    } as unknown as Partial<ScryfallCard>);
    expect(cubeFromResolvedCards([dfc]).cards[0]).toMatchObject({
      typeLine: 'Creature — Human Wizard',
      colors: ['U'],
      image: 'f.jpg',
    });
  });
});

describe('importPastedCube', () => {
  it('sends the cleaned text and returns the resolved cube plus unmatched names', async () => {
    importDeckText.mockResolvedValue(
      response({
        cards: [card('Lightning Bolt', 'b')],
        sideboard: [card('Sol Ring', 's')],
        unresolvedNames: ['Incubation Druidd'],
      })
    );
    const out = await importPastedCube(DRAFTMANCER_FIXTURE);
    expect(importDeckText.mock.calls[0][0]).not.toContain('[Settings]');
    expect(out.cube.cards.map((c) => c.name)).toEqual(['Lightning Bolt', 'Sol Ring']);
    expect(out.unresolved).toEqual(['Incubation Druidd']);
  });

  it('rejects an empty paste and a list that matches nothing', async () => {
    await expect(importPastedCube('# only a comment')).rejects.toBeInstanceOf(CubeImportError);
    expect(importDeckText).not.toHaveBeenCalled();
    importDeckText.mockResolvedValue(response({ unresolvedNames: ['zzz'] }));
    await expect(importPastedCube('zzz')).rejects.toBeInstanceOf(CubeImportError);
  });
});
