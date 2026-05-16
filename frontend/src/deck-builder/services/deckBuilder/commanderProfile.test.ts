import { describe, it, expect } from 'vitest';
import {
  buildCommanderProfile,
  whyCardMatches,
  getCombinedOracleText,
  type CommanderKeyword,
} from './commanderProfile';
import { Archetype } from '@/deck-builder/types';
import type { ScryfallCard } from '@/deck-builder/types';

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id-1',
    oracle_id: 'oracle-1',
    name: 'Test Card',
    cmc: 3,
    type_line: 'Legendary Creature',
    oracle_text: '',
    color_identity: ['W', 'B'],
    keywords: [],
    rarity: 'mythic',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

const keywords = (cmd: ScryfallCard): CommanderKeyword[] =>
  buildCommanderProfile(cmd).abilities.map((a) => a.keyword);

describe('buildCommanderProfile', () => {
  it('detects sacrifice, +1/+1 counters and leaves-the-battlefield (Habby-like)', () => {
    const habby = makeCard({
      name: 'Habby, Bare Spirit',
      type_line: 'Legendary Creature — Bear Spirit',
      oracle_text:
        'Whenever Habby enters or attacks, you may sacrifice another creature or artifact. If you do, put two +1/+1 counters on Habby.\nWhen Habby leaves the battlefield, put its counters on target creature you control.',
    });
    const profile = buildCommanderProfile(habby);
    const kw = profile.abilities.map((a) => a.keyword);

    expect(kw).toContain('etb');
    expect(kw).toContain('attack-trigger');
    expect(kw).toContain('sacrifice');
    expect(kw).toContain('plus-one-counters');
    expect(kw).toContain('leaves-battlefield');
    expect(profile.primaryArchetype).toBe(Archetype.ARISTOCRATS);
    expect(profile.suggestedThemes).toContain('aristocrats');
    expect(profile.suggestedThemes).toContain('+1/+1 counters');
    expect(profile.summary.toLowerCase()).toContain('habby');
  });

  it('strips reminder text and neutralizes the card name', () => {
    const text = getCombinedOracleText(
      makeCard({
        name: 'Krenko, Mob Boss',
        oracle_text:
          'Whenever Krenko, Mob Boss attacks, create a token. Krenko gets +1/+1 (this is a counter).',
      })
    );
    expect(text).not.toContain('krenko');
    expect(text).not.toContain('(this is a counter)');
    expect(text).toContain('~');
  });

  it('detects a spellslinger commander', () => {
    const kw = keywords(
      makeCard({
        name: 'Spella, the Caster',
        type_line: 'Legendary Creature — Human Wizard',
        oracle_text: 'Whenever you cast an instant or sorcery spell, draw a card.',
      })
    );
    expect(kw).toContain('spellcast');
    expect(kw).toContain('draw');
  });

  it('detects lifegain + drain and maps to aristocrats archetype', () => {
    const profile = buildCommanderProfile(
      makeCard({
        name: 'Drainer',
        oracle_text: 'Whenever you gain life, each opponent loses that much life.',
      })
    );
    const kw = profile.abilities.map((a) => a.keyword);
    expect(kw).toContain('lifegain');
    expect(kw).toContain('lifeloss-drain');
    expect(profile.primaryArchetype).toBe(Archetype.ARISTOCRATS);
  });

  it('detects tribal from creature subtypes', () => {
    const profile = buildCommanderProfile(
      makeCard({
        name: 'Goblin King',
        type_line: 'Legendary Creature — Goblin Warrior',
        oracle_text: 'Other Goblins you control get +1/+0.',
      })
    );
    expect(profile.tribes).toContain('goblin');
    expect(profile.suggestedThemes).toContain('goblins');
    expect(profile.abilities.some((a) => a.keyword === 'tribal')).toBe(true);
  });

  it('detects voltron from stacked evasion keywords with no engine', () => {
    const profile = buildCommanderProfile(
      makeCard({
        name: 'Sword Lord',
        type_line: 'Legendary Creature',
        oracle_text: '',
        power: '4',
        toughness: '4',
        keywords: ['Trample', 'Double strike'],
      })
    );
    expect(profile.abilities.some((a) => a.keyword === 'voltron')).toBe(true);
    expect(profile.primaryArchetype).toBe(Archetype.VOLTRON);
  });

  it('reads oracle text from every card face (DFC commander)', () => {
    const kw = keywords(
      makeCard({
        name: 'Front // Back',
        oracle_text: undefined,
        card_faces: [
          { name: 'Front', type_line: 'Legendary Creature — Elf', oracle_text: 'Vigilance' },
          {
            name: 'Back',
            type_line: 'Legendary Creature — Elf',
            oracle_text: 'Whenever Back enters the battlefield, search your library for a Forest.',
          },
        ],
      })
    );
    expect(kw).toContain('etb');
    expect(kw).toContain('tutor');
  });

  it('ranks the primary archetype ahead of incidental signals (Teval)', () => {
    // Teval attacks to mill + recurs lands + makes tokens on graveyard
    // churn. The attack trigger is incidental — this is a reanimator deck,
    // and the preselected themes must lead with that, not "aggro".
    const profile = buildCommanderProfile(
      makeCard({
        name: 'Teval, the Balanced Scale',
        type_line: 'Legendary Creature — Spirit Dragon',
        keywords: ['Flying'],
        oracle_text:
          'Flying\nWhenever Teval attacks, mill three cards. Then you may return a land card from your graveyard to the battlefield tapped.\nWhenever one or more cards leave your graveyard, create a 2/2 black Zombie Druid creature token.',
      })
    );

    expect(profile.primaryArchetype).toBe(Archetype.REANIMATOR);

    const themes = profile.suggestedThemes;
    const firstReanimatorIdx = Math.min(
      ...['reanimator', 'graveyard', 'mill'].map((t) =>
        themes.indexOf(t) === -1 ? Infinity : themes.indexOf(t)
      )
    );
    const firstAggroIdx = Math.min(
      ...['aggro', 'attack triggers', 'combat'].map((t) =>
        themes.indexOf(t) === -1 ? Infinity : themes.indexOf(t)
      )
    );
    expect(firstReanimatorIdx).toBeLessThan(firstAggroIdx);
    // The first listed ability should belong to the detected archetype.
    expect(profile.abilities[0].archetypeHint).toBe(Archetype.REANIMATOR);
  });

  it('returns a graceful summary for a vanilla commander', () => {
    const profile = buildCommanderProfile(makeCard({ name: 'Plain Bear', oracle_text: '' }));
    expect(profile.abilities).toHaveLength(0);
    expect(profile.primaryArchetype).toBe(Archetype.GOODSTUFF);
    expect(profile.summary).toContain('Plain Bear');
  });
});

describe('whyCardMatches', () => {
  const habby = makeCard({
    name: 'Habby, Bare Spirit',
    oracle_text:
      'Whenever Habby enters or attacks, you may sacrifice another creature or artifact. If you do, put two +1/+1 counters on Habby.\nWhen Habby leaves the battlefield, put its counters on target creature you control.',
  });
  const profile = buildCommanderProfile(habby);

  it('flags a token maker as sac fodder', () => {
    const reasons = whyCardMatches(
      makeCard({
        name: 'Token Maker',
        oracle_text: 'At the beginning of your end step, create a 1/1 white Spirit creature token.',
      }),
      profile
    );
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join(' ').toLowerCase()).toMatch(/sac|token/);
  });

  it('flags a blink spell for ETB / leaves-the-battlefield', () => {
    const reasons = whyCardMatches(
      makeCard({
        name: 'Flicker Spell',
        type_line: 'Instant',
        oracle_text: 'Exile target creature you control, then return it to the battlefield.',
      }),
      profile
    );
    expect(reasons.length).toBeGreaterThan(0);
  });

  it('returns no reasons for an unrelated card', () => {
    const reasons = whyCardMatches(
      makeCard({
        name: 'Unrelated',
        type_line: 'Instant',
        oracle_text: 'Counter target spell.',
      }),
      profile
    );
    expect(reasons).toHaveLength(0);
  });

  it('caps the number of reasons', () => {
    const reasons = whyCardMatches(
      makeCard({
        name: 'Everything',
        oracle_text:
          'When this enters, sacrifice a creature, put a +1/+1 counter on it, create a token, draw a card.',
      }),
      profile,
      2
    );
    expect(reasons.length).toBeLessThanOrEqual(2);
  });
});
