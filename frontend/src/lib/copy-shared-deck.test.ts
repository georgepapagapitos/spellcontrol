// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { sharedDeckToCreateInput } from './copy-shared-deck';
import type { PublicDeck } from './shared-types';

function makeCard(name: string, id: string) {
  return {
    id,
    name,
    image_uris: {
      small: `https://example.com/${id}-small.jpg`,
      normal: `https://example.com/${id}.jpg`,
    },
    type_line: 'Creature — Dragon',
    mana_cost: '{3}{R}',
    cmc: 4,
    colors: ['R'],
    color_identity: ['R'],
    set: 'cmd',
    set_name: 'Commander',
    collector_number: '001',
    rarity: 'rare',
  };
}

const fakePublicDeck: PublicDeck = {
  ownerUsername: 'alex',
  ownerDisplayName: null,
  id: 'deck-abc',
  name: 'Korvold Treasure',
  format: 'commander',
  commander: makeCard('Korvold, Fae-Cursed King', 'korvold-id'),
  partnerCommander: null,
  cards: [
    { card: makeCard('Sol Ring', 'sol-ring-id') },
    { card: makeCard('Rampant Growth', 'rampant-id') },
    { card: makeCard('Dockside Extortionist', 'dockside-id') },
  ],
  sideboard: [{ card: makeCard('Forest', 'forest-id') }],
  color: '#7c3aed',
};

describe('sharedDeckToCreateInput', () => {
  it('sets source to manual', () => {
    const input = sharedDeckToCreateInput(fakePublicDeck);
    expect(input.source).toBe('manual');
  });

  it('appends (copy) to the name', () => {
    const input = sharedDeckToCreateInput(fakePublicDeck);
    expect(input.name).toMatch(/\(copy\)$/);
    expect(input.name).toContain('Korvold Treasure');
  });

  it('passes through the format', () => {
    const input = sharedDeckToCreateInput(fakePublicDeck);
    expect(input.format).toBe('commander');
  });

  it('falls back to commander format when format is empty', () => {
    const input = sharedDeckToCreateInput({ ...fakePublicDeck, format: '' });
    expect(input.format).toBe('commander');
  });

  it('maps 3 mainboard cards with allocatedCopyId null', () => {
    const input = sharedDeckToCreateInput(fakePublicDeck);
    expect(input.cards).toHaveLength(3);
    for (const card of input.cards) {
      expect(card.allocatedCopyId).toBeNull();
    }
  });

  it('assigns distinct slotIds to each mainboard card', () => {
    const input = sharedDeckToCreateInput(fakePublicDeck);
    const ids = input.cards.map((c) => c.slotId);
    expect(new Set(ids).size).toBe(3);
  });

  it('maps 1 sideboard card with allocatedCopyId null', () => {
    const input = sharedDeckToCreateInput(fakePublicDeck);
    expect(input.sideboard).toHaveLength(1);
    expect(input.sideboard[0].allocatedCopyId).toBeNull();
  });

  it('preserves the commander', () => {
    const input = sharedDeckToCreateInput(fakePublicDeck);
    expect(input.commander).not.toBeNull();
    expect((input.commander as { name: string }).name).toBe('Korvold, Fae-Cursed King');
  });

  it('passes null partnerCommander through', () => {
    const input = sharedDeckToCreateInput(fakePublicDeck);
    expect(input.partnerCommander).toBeNull();
  });

  it('does not include bracket/grade/synergy/salt fields', () => {
    const input = sharedDeckToCreateInput(fakePublicDeck);
    expect(input).not.toHaveProperty('bracketEstimation');
    expect(input).not.toHaveProperty('deckGrade');
    expect(input).not.toHaveProperty('averageSalt');
  });
});
