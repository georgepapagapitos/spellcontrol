import { describe, expect, it } from 'vitest';
import { Archetype } from '@/deck-builder/types';
import { archetypeChecks, hasArchetypeChecks, MIN_MAINBOARD } from './archetypeChecks';
import { REAL } from './archetypeChecks.fixtures';

const tagsOf = (name: string) => REAL[name]?.tags ?? [];

/** A 99-card mainboard: the named cards, then vanilla creatures to fill. */
function deck(spec: Record<string, number>, size = 99, filler = 'Grizzly Bears') {
  const cards = Object.entries(spec).flatMap(([name, n]) =>
    Array.from({ length: n }, () => REAL[name])
  );
  while (cards.length < size) cards.push(REAL[filler]);
  return cards;
}

const run = (
  archetype: Archetype | undefined,
  spec: Record<string, number>,
  extra: { size?: number; commanders?: string[]; filler?: string } = {}
) =>
  archetypeChecks({
    archetype,
    mainboard: deck(spec, extra.size, extra.filler),
    commanders: (extra.commanders ?? []).map((n) => REAL[n]),
    tagsOf,
  });

const ids = (f: { id: string }[]) => f.map((x) => x.id);

describe('archetype checks', () => {
  it('flags one sacrifice outlet in an Aristocrats deck, with its basis', () => {
    const found = run(Archetype.ARISTOCRATS, {
      'Viscera Seer': 1,
      'Blood Artist': 3,
      'Zulaport Cutthroat': 3,
    });
    expect(ids(found)).toEqual(['sacrifice-outlets']);
    const [f] = found;
    expect(f.severity).toBe('warn');
    expect(f.count).toBe(1);
    expect(f.floor).toBe(4);
    expect(f.claim).toBe('Most Aristocrats decks run 4 or more repeatable sacrifice outlets.');
    expect(f.basis).toBe(
      '11 of 12 EDHREC average aristocrats decks and 8 of 8 Archidekt lists run 4 or more.'
    );
    expect(f.names).toEqual(['Viscera Seer']);
  });

  it('says nothing when the deck reaches every floor', () => {
    const found = run(Archetype.ARISTOCRATS, {
      'Viscera Seer': 2,
      "Ashnod's Altar": 1,
      'Carrion Feeder': 1,
      'Blood Artist': 2,
      'Zulaport Cutthroat': 2,
    });
    expect(found).toEqual([]);
  });

  it('counts the commander toward a class', () => {
    const spec = { 'Viscera Seer': 1, "Ashnod's Altar": 1, 'Carrion Feeder': 1, 'Blood Artist': 4 };
    expect(ids(run(Archetype.ARISTOCRATS, spec))).toEqual(['sacrifice-outlets']);
    expect(run(Archetype.ARISTOCRATS, spec, { commanders: ['Yawgmoth, Thran Physician'] })).toEqual(
      []
    );
  });

  it('flags missing death payoffs next to a full outlet package', () => {
    const found = run(Archetype.ARISTOCRATS, {
      'Viscera Seer': 2,
      "Ashnod's Altar": 1,
      'Carrion Feeder': 1,
      'Blood Artist': 1,
    });
    expect(ids(found)).toEqual(['death-payoffs']);
  });

  it('stays quiet on an unfinished list', () => {
    expect(run(Archetype.ARISTOCRATS, { 'Viscera Seer': 1 }, { size: MIN_MAINBOARD - 1 })).toEqual(
      []
    );
    expect(run(Archetype.ARISTOCRATS, { 'Viscera Seer': 1 }, { size: MIN_MAINBOARD })).not.toEqual(
      []
    );
  });

  it('stays quiet for an archetype the measurement does not cover', () => {
    expect(run(Archetype.CONTROL, { 'Viscera Seer': 1 })).toEqual([]);
    expect(run(Archetype.GOODSTUFF, {})).toEqual([]);
    expect(run(undefined, {})).toEqual([]);
    expect(hasArchetypeChecks(Archetype.AGGRO)).toBe(false);
    expect(hasArchetypeChecks(Archetype.TOKENS)).toBe(true);
  });

  it('Tokens: protection is asked only of a deck that goes wide', () => {
    const wide = {
      'Grave Titan': 4,
      Ophiomancer: 4,
      Bitterblossom: 2,
      'Krenko, Mob Boss': 2,
      'Glorious Anthem': 3,
      Overrun: 2,
    };
    const found = run(Archetype.TOKENS, wide);
    expect(ids(found)).toEqual(['token-protection']);
    expect(found[0].severity).toBe('note');
    expect(
      run(Archetype.TOKENS, { ...wide, 'Heroic Intervention': 1, "Teferi's Protection": 1 })
    ).toEqual([]);
    // Eight makers: under the wide-board bar, so no protection note; and at the maker floor.
    expect(
      run(Archetype.TOKENS, { 'Grave Titan': 4, Ophiomancer: 4, 'Glorious Anthem': 4 })
    ).toEqual([]);
  });

  it('Tokens: too few makers and team effects', () => {
    const found = run(Archetype.TOKENS, { 'Grave Titan': 3, 'Glorious Anthem': 1 });
    expect(ids(found).sort()).toEqual(['team-effects', 'token-makers']);
  });

  it('Voltron: a warning under 5 protection, a note under 7, nothing from 7', () => {
    const at = (n: number) =>
      run(Archetype.VOLTRON, { 'Heroic Intervention': n })
        .filter((f) => f.id === 'voltron-protection')
        .map((f) => [f.severity, f.floor]);
    expect(at(3)).toEqual([['warn', 5]]);
    expect(at(6)).toEqual([['note', 7]]);
    expect(at(7)).toEqual([]);
  });

  it('Landfall: lands plus fetch against the floor, and the payoffs', () => {
    const lands = (n: number, fetch: number) => ({ Forest: n, Cultivate: fetch, 'Lotus Cobra': 8 });
    const lof = (n: number, fetch: number) =>
      run(Archetype.LANDFALL, lands(n, fetch)).find((f) => f.id === 'lands-and-fetch');
    expect(lof(30, 10)?.severity).toBe('warn');
    expect(lof(30, 10)?.count).toBe(40);
    expect(lof(36, 11)?.severity).toBe('note');
    expect(lof(40, 10)).toBeUndefined();
    const payoffs = run(Archetype.LANDFALL, { Forest: 40, Cultivate: 10, 'Lotus Cobra': 2 });
    expect(ids(payoffs)).toEqual(['landfall-payoffs']);
  });

  it('Reanimator: fillers and reanimation are each asked for', () => {
    const found = run(Archetype.REANIMATOR, { Entomb: 1, Reanimate: 1 });
    expect(ids(found).sort()).toEqual(['graveyard-fillers', 'reanimation']);
    expect(
      run(Archetype.REANIMATOR, {
        Entomb: 2,
        'Faithless Looting': 1,
        "Stitcher's Supplier": 1,
        Reanimate: 1,
        'Animate Dead': 1,
        'Sun Titan': 2,
      })
    ).toEqual([]);
  });

  it('Spellslinger, Enchantress and Artifacts count their type', () => {
    expect(ids(run(Archetype.SPELLSLINGER, { 'Lightning Bolt': 20 }))).toEqual([
      'instants-sorceries',
    ]);
    expect(run(Archetype.SPELLSLINGER, { 'Lightning Bolt': 28 })).toEqual([]);
    const ench = run(Archetype.ENCHANTRESS, { 'Rhystic Study': 26 });
    expect(ench.map((f) => [f.id, f.severity])).toEqual([['enchantments', 'note']]);
    expect(run(Archetype.ARTIFACTS, { 'Sol Ring': 10 }).map((f) => f.severity)).toEqual(['warn']);
  });

  it('puts warnings before notes', () => {
    const found = run(Archetype.TOKENS, { 'Grave Titan': 6, Ophiomancer: 6, 'Glorious Anthem': 1 });
    expect(found.map((f) => f.severity)).toEqual(['warn', 'note']);
  });
});
