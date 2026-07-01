import { describe, it, expect } from 'vitest';
import {
  findBinderById,
  findCubeById,
  findDeckById,
  findListById,
  projectBinder,
  projectCard,
  projectCollection,
  projectCube,
  projectDeck,
  projectList,
} from './projections';

function binderDef(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'b-1',
    name: 'Artifacts',
    position: 0,
    filterGroups: [
      { filter: { typeChips: { chips: [{ value: 'artifact', negate: false }], joiners: [] } } },
    ],
    sorts: [{ field: 'color', dir: 'asc' }],
    pocketSize: 9,
    doubleSided: false,
    fixedCapacity: null,
    color: '#c2a14a',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function card(name: string, typeLine: string): Record<string, unknown> {
  return {
    copyId: `copy-${name}`,
    name,
    scryfallId: `sf-${name}`,
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    finish: 'nonfoil',
    foil: false,
    purchasePrice: 2,
    typeLine,
    sourceFormat: 'manabox',
    sourceCategory: 'Box',
  };
}

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

  it('carries the filter facet fields and trims legalities to filterable formats', () => {
    const out = projectCard({
      name: 'Sol Ring',
      scryfallId: 'sol-ring-id',
      oracleText: '{T}: Add {C}{C}.',
      frameEffects: ['showcase'],
      fullArt: true,
      borderColor: 'borderless',
      legalities: {
        commander: 'legal',
        vintage: 'legal',
        modern: 'not_legal',
        // Non-filterable formats must be dropped from the public payload:
        alchemy: 'legal',
        historic: 'legal',
        oldschool: 'legal',
      },
    });
    expect(out).not.toBeNull();
    const o = out!;
    expect(o.oracleText).toBe('{T}: Add {C}{C}.');
    expect(o.frameEffects).toEqual(['showcase']);
    expect(o.fullArt).toBe(true);
    expect(o.borderColor).toBe('borderless');
    expect(o.legalities).toEqual({ commander: 'legal', vintage: 'legal', modern: 'not_legal' });
    expect(o.legalities && 'alchemy' in o.legalities).toBe(false);
    expect(o.legalities && 'historic' in o.legalities).toBe(false);
  });

  it('omits legalities entirely when no filterable format is present', () => {
    const out = projectCard({
      name: 'X',
      scryfallId: 'x',
      legalities: { alchemy: 'legal', historic: 'legal' },
    });
    expect(out?.legalities).toBeUndefined();
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

describe('findListById / findDeckById / findBinderById', () => {
  it('finds nested resources by id', () => {
    const col = { lists: [{ id: 'a' }, { id: 'b', name: 'b' }] };
    expect(findListById(col, 'b')).toMatchObject({ id: 'b' });
    expect(findListById(col, 'missing')).toBeUndefined();
    expect(findBinderById([{ id: 'b-1' }, { id: 'b-2' }], 'b-2')).toMatchObject({ id: 'b-2' });
    expect(findBinderById([{ id: 'b-1' }], 'nope')).toBeUndefined();
  });

  it('returns null for malformed inputs', () => {
    expect(findListById(null, 'x')).toBeNull();
    expect(findDeckById(null, 'x')).toBeNull();
    expect(findDeckById('not-an-array', 'x')).toBeNull();
    expect(findBinderById(null, 'x')).toBeNull();
    expect(findBinderById('not-an-array', 'x')).toBeNull();
  });
});

function savedCube(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cube-1',
    name: 'My Pauper Cube',
    size: 360,
    savedAt: 1700000000000,
    cube: {
      size: 360,
      picks: [
        {
          card: {
            name: 'Lightning Bolt',
            oracleId: 'o-bolt',
            colors: ['R'],
            cmc: 1,
            typeLine: 'Instant',
          },
          bucket: 'R',
          reason: 'premium removal',
        },
        {
          card: {
            name: 'Counterspell',
            oracleId: 'o-cs',
            colors: ['U'],
            cmc: 2,
            typeLine: 'Instant',
          },
          bucket: 'U',
          reason: 'interaction',
        },
      ],
      byBucket: { R: 1, U: 1 },
      targetByBucket: { R: 60, U: 60 },
      gaps: [{ severity: 'short', text: '58 short on red' }],
      shortfall: 358,
      poolSize: 2,
    },
    ...overrides,
  };
}

describe('findCubeById', () => {
  it('finds a saved cube by id; null for non-array / missing', () => {
    const cubes = [{ id: 'a' }, savedCube({ id: 'cube-1' })];
    expect(findCubeById(cubes, 'cube-1')).toMatchObject({ id: 'cube-1' });
    expect(findCubeById(cubes, 'missing')).toBeUndefined();
    expect(findCubeById(null, 'x')).toBeNull();
    expect(findCubeById('nope', 'x')).toBeNull();
  });
});

describe('projectCube', () => {
  it('returns null for malformed input / missing id or name', () => {
    expect(projectCube('alice', null)).toBeNull();
    expect(projectCube('alice', 42)).toBeNull();
    expect(projectCube('alice', { id: 'c1' })).toBeNull();
    expect(projectCube('alice', { name: 'no id' })).toBeNull();
  });

  it('projects a valid saved cube faithfully', () => {
    const out = projectCube('alice', savedCube());
    expect(out).not.toBeNull();
    const o = out!;
    expect(o.ownerUsername).toBe('alice');
    expect(o.id).toBe('cube-1');
    expect(o.name).toBe('My Pauper Cube');
    expect(o.size).toBe(360);
    expect(o.cards).toHaveLength(2);
    expect(o.cards[0]).toMatchObject({
      name: 'Lightning Bolt',
      bucket: 'R',
      reason: 'premium removal',
    });
    expect(o.byBucket).toEqual({ R: 1, U: 1 });
    expect(o.targetByBucket).toEqual({ R: 60, U: 60 });
    expect(o.gaps).toEqual([{ severity: 'short', text: '58 short on red' }]);
    expect(o.shortfall).toBe(358);
    expect(o.poolSize).toBe(2);
  });

  it('drops picks whose nested card lacks name/oracleId', () => {
    const cube = savedCube();
    (cube.cube as { picks: unknown[] }).picks.push(
      { card: { name: 'No Oracle' }, bucket: 'G', reason: 'x' },
      { card: null, bucket: 'G', reason: 'x' },
      'not a pick'
    );
    const out = projectCube('alice', cube);
    expect(out?.cards).toHaveLength(2);
  });

  it('drops malformed gaps and tolerates a missing inner cube', () => {
    const out = projectCube('alice', { id: 'c', name: 'Empty' });
    expect(out).not.toBeNull();
    expect(out?.cards).toEqual([]);
    expect(out?.byBucket).toEqual({});
    expect(out?.gaps).toEqual([]);
    expect(out?.shortfall).toBe(0);
  });
});

describe('projectBinder', () => {
  const collection = {
    cards: [
      card('Sol Ring', 'Artifact'),
      card('Arcane Signet', 'Artifact'),
      card('Llanowar Elves', 'Creature — Elf Druid'),
    ],
  };

  it('returns null for a malformed or missing binders array', () => {
    expect(projectBinder('alice', 'b-1', collection, null)).toBeNull();
    expect(projectBinder('alice', 'b-1', collection, 'nope')).toBeNull();
    expect(projectBinder('alice', 'missing', collection, [binderDef()])).toBeNull();
  });

  it('materializes the binder and projects only its matched cards', () => {
    const out = projectBinder('alice', 'b-1', collection, [binderDef()]);
    expect(out).not.toBeNull();
    const o = out!;
    expect(o.ownerUsername).toBe('alice');
    expect(o.name).toBe('Artifacts');
    expect(o.color).toBe('#c2a14a');
    expect(o.updatedAt).toBe(2);
    // The artifact filter routes the two artifacts in, not the creature.
    expect(o.totalCards).toBe(2);
    const names = o.sections.flatMap((s) => s.cards.map((c) => c.name)).sort();
    expect(names).toEqual(['Arcane Signet', 'Sol Ring']);
    expect(o.totalValue).toBe(4);
    // Internal per-copy fields are stripped by projectCard.
    const first = o.sections[0].cards[0];
    expect('copyId' in first).toBe(false);
    expect('sourceFormat' in first).toBe(false);
  });

  it('honors first-match-wins routing across multiple binders', () => {
    // An earlier (lower position) catch-all binder claims the artifacts, so
    // the shared b-1 binder ends up empty.
    const catchAll = binderDef({
      id: 'b-0',
      name: 'Everything',
      position: -1,
      filterGroups: [{ filter: {} }],
    });
    const out = projectBinder('alice', 'b-1', collection, [catchAll, binderDef()]);
    expect(out?.totalCards).toBe(0);
  });

  it('returns an empty binder when the owner has no collection', () => {
    const out = projectBinder('alice', 'b-1', null, [binderDef()]);
    expect(out?.totalCards).toBe(0);
    expect(out?.sections).toEqual([]);
  });
});
