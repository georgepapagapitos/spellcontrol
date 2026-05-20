import { describe, it, expect } from 'vitest';
import {
  findDeckById,
  findListById,
  projectCard,
  projectCollection,
  projectDeck,
  projectList,
} from './projections';

describe('projectCard', () => {
  it('returns null on non-objects', () => {
    expect(projectCard(null)).toBeNull();
    expect(projectCard('Sol Ring')).toBeNull();
    expect(projectCard(42)).toBeNull();
  });

  it('returns null when required identity fields are missing', () => {
    expect(projectCard({ name: 'Sol Ring' })).toBeNull();
    expect(projectCard({ scryfallId: 'id' })).toBeNull();
  });

  it('strips internal/owner-only fields', () => {
    const out = projectCard({
      name: 'Sol Ring',
      scryfallId: 'sol-ring-id',
      copyId: 'copy-1',
      importId: 'imp-1',
      sourceFormat: 'manabox',
      sourceCategory: 'My Box',
      pricedAt: 1700000000000,
      finish: 'foil',
      foil: true,
      purchasePrice: 4.2,
    });
    expect(out).not.toBeNull();
    const o = out!;
    expect(o.name).toBe('Sol Ring');
    expect(o.finish).toBe('foil');
    expect(o.foil).toBe(true);
    expect(o.purchasePrice).toBe(4.2);
    // Keys that should not exist:
    expect('copyId' in o).toBe(false);
    expect('importId' in o).toBe(false);
    expect('sourceFormat' in o).toBe(false);
    expect('sourceCategory' in o).toBe(false);
    expect('pricedAt' in o).toBe(false);
  });

  it('coerces unknown finishes to nonfoil', () => {
    const out = projectCard({ name: 'X', scryfallId: 'x', finish: 'gilded' });
    expect(out?.finish).toBe('nonfoil');
  });
});

describe('projectCollection', () => {
  it('returns empty cards for null input', () => {
    const out = projectCollection('alice', null);
    expect(out.cards).toEqual([]);
    expect(out.ownerUsername).toBe('alice');
  });

  it('skips invalid card entries instead of throwing', () => {
    const out = projectCollection('alice', {
      cards: [{ name: 'Sol Ring', scryfallId: 'sr' }, 'not a card', null, { name: 'No Id' }],
    });
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0].name).toBe('Sol Ring');
  });
});

describe('projectList', () => {
  it('returns null for malformed input', () => {
    expect(projectList('alice', null)).toBeNull();
    expect(projectList('alice', { name: 'no id' })).toBeNull();
  });

  it('keeps note and targetPrice (v1 share scope)', () => {
    const out = projectList('alice', {
      id: 'l1',
      name: 'Wants',
      entries: [
        {
          name: 'Mana Crypt',
          scryfallId: 'mc',
          note: 'at LGS',
          targetPrice: 100,
          finish: 'foil',
          quantity: 1,
        },
      ],
    });
    expect(out?.entries[0].note).toBe('at LGS');
    expect(out?.entries[0].targetPrice).toBe(100);
    expect(out?.entries[0].finish).toBe('foil');
  });
});

describe('projectDeck', () => {
  it('returns null for malformed input', () => {
    expect(projectDeck('alice', null)).toBeNull();
    expect(projectDeck('alice', { id: 'd1' })).toBeNull();
  });

  it('drops slotId / allocatedCopyId from slots', () => {
    const out = projectDeck('alice', {
      id: 'd1',
      name: 'X',
      format: 'commander',
      commander: { name: 'Edric' },
      cards: [{ slotId: 's1', card: { name: 'Sol Ring' }, allocatedCopyId: 'c1' }],
      sideboard: [],
      color: '#888',
    });
    expect(out?.cards).toHaveLength(1);
    const slot = out!.cards[0];
    expect((slot as { card: { name: string } }).card.name).toBe('Sol Ring');
    expect('slotId' in slot).toBe(false);
    expect('allocatedCopyId' in slot).toBe(false);
  });
});

describe('findListById / findDeckById', () => {
  it('finds nested resources by id', () => {
    const col = { lists: [{ id: 'a' }, { id: 'b', name: 'b' }] };
    expect(findListById(col, 'b')).toMatchObject({ id: 'b' });
    expect(findListById(col, 'missing')).toBeUndefined();
  });

  it('returns null for malformed inputs', () => {
    expect(findListById(null, 'x')).toBeNull();
    expect(findDeckById(null, 'x')).toBeNull();
    expect(findDeckById('not-an-array', 'x')).toBeNull();
  });
});
