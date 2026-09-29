import { describe, expect, it } from 'vitest';
import { classifyCard } from '../synergy/classify';
import { CORPUS } from '../synergy/classify.fixtures';
import { extractCardFacts } from './extract';
import { GOLD } from './gold.fixtures';
import { HOLDOUT } from './gold.holdout.fixtures';
import {
  RESOURCE_AXIS,
  countsAsRole,
  type CardFacts,
  type FactRole,
  type FactsInputCard,
} from './schema';
import { TEST_CARDS } from './test-cards.fixtures';

const byName = new Map([...GOLD, ...HOLDOUT].map((g) => [g.card.name, g]));
const facts = (name: string): CardFacts => {
  const g = byName.get(name);
  if (!g) throw new Error(`no fixture card ${name}`);
  return extractCardFacts(g.card, g.tags);
};
const role = (f: CardFacts, r: FactRole) => f.roles.find((x) => x.role === r);
const counted = (f: CardFacts) =>
  f.roles
    .filter(countsAsRole)
    .map((r) => r.role)
    .sort();

describe('the E476/E486/E487 troublemakers', () => {
  it('Liliana, Dreadhorde General: a draw engine and an edict, her ultimate recorded but never counted', () => {
    const f = facts('Liliana, Dreadhorde General');
    expect(role(f, 'cardDraw')).toMatchObject({
      tier: 'primary',
      speed: 'triggered',
      repeat: 'per-event',
    });
    expect(role(f, 'removal')).toMatchObject({ tier: 'secondary', sub: 'edict' });
    expect(role(f, 'boardwipe')).toMatchObject({
      tier: 'incidental',
      limits: expect.arrayContaining(['ultimate']),
    });
    expect(counted(f)).toEqual(['cardDraw', 'removal']);
  });

  it('a counterspell is never removal, and says it hits spells', () => {
    for (const name of [
      'Counterspell',
      'Negate',
      'Swan Song',
      'Stifle',
      'Mana Drain',
      'Fierce Guardianship',
    ]) {
      const f = facts(name);
      expect(counted(f)).toContain('counterspell');
      expect(counted(f)).not.toContain('removal');
      expect(f.interaction.every((i) => i.mode === 'counter')).toBe(true);
      expect(
        f.interaction
          .flatMap((i) => i.hits)
          .some((h) => ['creature', 'permanent', 'nonland-permanent'].includes(h))
      ).toBe(false);
    }
  });

  it('Mana Drain and Sword of Feast and Famine do not count as ramp', () => {
    expect(role(facts('Mana Drain'), 'ramp')?.tier).toBe('incidental');
    expect(role(facts('Sword of Feast and Famine'), 'ramp')?.tier).toBe('incidental');
  });

  it('Deadbridge Chant: graveyard-to-hand is card draw', () => {
    const f = facts('Deadbridge Chant');
    expect(counted(f)).toEqual(['cardDraw', 'recursion']);
    expect(role(f, 'cardDraw')).toMatchObject({ sub: 'gy-to-hand', repeat: 'per-turn' });
  });

  it('Elesh Norn: the wipe comes from the back face and never fills a slot', () => {
    const f = facts('Elesh Norn // The Argent Etchings');
    expect(role(f, 'boardwipe')).toMatchObject({ tier: 'incidental', face: 1 });
    expect(f.interaction).toEqual([
      expect.objectContaining({
        mode: 'destroy',
        scope: 'mass',
        side: 'all',
        face: 1,
        limits: expect.arrayContaining(['transform', 'except']),
      }),
    ]);
    expect(counted(f)).toEqual([]);
  });

  it('Harmonized Trio // Brainstorm: the draw is on the prepare face, a step down from Brainstorm', () => {
    expect(role(facts('Harmonized Trio // Brainstorm'), 'cardDraw')).toMatchObject({
      tier: 'secondary',
      face: 1,
    });
    expect(role(facts('Brainstorm'), 'cardDraw')).toMatchObject({ tier: 'primary', face: 0 });
  });
});

describe('roles', () => {
  it('a tag with no text behind it is recorded as incidental with low confidence', () => {
    // Cryptic Command carries the tagger's spot-removal tag; its bounce mode is
    // the removal, so the tag agrees. Elesh Norn's removal tag has no text.
    const norn = role(facts('Elesh Norn // The Argent Etchings'), 'removal');
    expect(norn).toMatchObject({ tier: 'incidental', src: ['tag'], ability: -1 });
    expect(norn!.conf).toBeLessThan(0.5);
  });

  it('parser evidence the tagger agrees with is more confident', () => {
    expect(role(facts('Swords to Plowshares'), 'removal')).toMatchObject({
      src: ['parser', 'tag'],
      conf: 0.95,
    });
  });

  it('a one-sided wipe says so', () => {
    const f = facts('Plague Wind');
    expect(f.interaction[0]).toMatchObject({ scope: 'mass', side: 'opponents' });
  });

  it('overload adds the mass reading at a capped tier', () => {
    const f = facts('Cyclonic Rift');
    expect(role(f, 'removal')?.tier).toBe('primary');
    expect(role(f, 'boardwipe')).toMatchObject({
      tier: 'secondary',
      limits: expect.arrayContaining(['overload']),
    });
  });

  it('a land never counts as ramp, but its spell side can fill a slot', () => {
    expect(role(facts('Boseiju, Who Endures'), 'removal')?.tier).toBe('secondary');
    expect(role(facts('Boseiju, Who Endures'), 'ramp')).toBeUndefined();
    expect(facts('Fell the Profane // Fell Mire').produces.map((p) => p.r)).toContain('mana');
  });
});

describe('flows', () => {
  it('projects onto synergy axes exactly as classifyCard does, over its labeled corpus', () => {
    for (const card of CORPUS) {
      const f = extractCardFacts({ ...card, oracle_id: card.name });
      const axes = (list: CardFacts['produces']) =>
        list.flatMap((x) => (RESOURCE_AXIS[x.r] ? [RESOURCE_AXIS[x.r]] : [])).sort();
      const synergy = classifyCard(card);
      expect({ name: card.name, p: axes(f.produces), o: axes(f.payoffs) }).toEqual({
        name: card.name,
        p: synergy.producers.map((x) => x.axis).sort(),
        o: synergy.payoffs.map((x) => x.axis).sort(),
      });
    }
  });

  it('points each flow at the ability that carries it', () => {
    const f = facts('Smothering Tithe');
    const treasure = f.produces.find((p) => p.r === 'treasure')!;
    expect(f.abilities[treasure.ability].trigger).toMatchObject({ event: 'draw', who: 'opp' });
  });
});

describe('strengths', () => {
  it('Butcher of Malakir: a Grave Pact first, fodder for itself, a big flier', () => {
    const f = extractCardFacts(TEST_CARDS['Butcher of Malakir']);
    expect(f.strengths).toMatchObject({
      'grave-pact': 1,
      'sac-fodder': 0.4,
      'big-body': 0.3,
      evasion: 0.2,
    });
    expect(f.pt).toEqual([5, 4]);
    expect(f.mv).toBe(7);
  });

  it('every role appears as a strength at its tier weight', () => {
    const f = facts('Liliana, Dreadhorde General');
    expect(f.strengths).toMatchObject({
      cardDraw: 1,
      removal: 0.6,
      'removal/edict': 0.6,
      boardwipe: 0.25,
    });
  });

  it('a repeatable free sac outlet is a full-strength outlet', () => {
    expect(facts('Viscera Seer').strengths['sac-outlet']).toBe(1);
    expect(facts("Ashnod's Altar").strengths['sac-outlet']).toBe(1);
  });
});

describe('determinism', () => {
  it('gives the same record for the same card twice', () => {
    for (const g of GOLD.slice(0, 50))
      expect(extractCardFacts(g.card, g.tags)).toEqual(extractCardFacts(g.card, g.tags));
  });

  it('extracts every fixture card without throwing', () => {
    for (const g of [...GOLD, ...HOLDOUT])
      expect(() => extractCardFacts(g.card, g.tags)).not.toThrow();
    const blank: FactsInputCard = { oracle_id: 'blank', name: 'Blank' };
    expect(extractCardFacts(blank)).toMatchObject({
      roles: [],
      abilities: [],
      interaction: [],
      pt: null,
      mv: null,
    });
  });
});
