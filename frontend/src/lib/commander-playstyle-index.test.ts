import { describe, it, expect } from 'vitest';
import {
  PLAYSTYLES,
  classifyCommanderPlaystyles,
  classifyOwnedCommanderPlaystyles,
  commanderMatchesPlaystyle,
  playstyleById,
} from './commander-playstyle-index';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../types';

/** Minimal ScryfallCard with the fields the classifier reads; override per test. */
function commander(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: name,
    oracle_id: `o-${name}`,
    name,
    cmc: 4,
    type_line: 'Legendary Creature — Human Wizard',
    color_identity: [],
    keywords: [],
    power: '3',
    toughness: '3',
    rarity: 'mythic',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...over,
  } as ScryfallCard;
}

/** ids of the matched playstyles, strongest first. */
function ids(card: ScryfallCard): string[] {
  return classifyCommanderPlaystyles(card).map((m) => m.playstyle.id);
}

describe('PLAYSTYLES vocabulary', () => {
  it('has unique ids and EDHREC slugs', () => {
    expect(new Set(PLAYSTYLES.map((p) => p.id)).size).toBe(PLAYSTYLES.length);
    expect(new Set(PLAYSTYLES.map((p) => p.edhrecSlug)).size).toBe(PLAYSTYLES.length);
  });

  it('every playstyle carries at least one signal', () => {
    for (const p of PLAYSTYLES) {
      expect(p.themeSignals.length + p.archetypeSignals.length).toBeGreaterThan(0);
    }
  });

  it('playstyleById resolves a known id and rejects an unknown one', () => {
    expect(playstyleById('tokens')?.label).toBe('Tokens (go wide)');
    expect(playstyleById('nope')).toBeUndefined();
  });
});

describe('classifyCommanderPlaystyles', () => {
  it('files a token maker under tokens', () => {
    const c = commander('Tana, the Bloodsower', {
      oracle_text:
        'Whenever Tana deals combat damage to a player, create a 1/1 green Saproling creature token.',
    });
    expect(ids(c)).toContain('tokens');
  });

  it('files a +1/+1 counter commander under counters (no false Voltron)', () => {
    const c = commander('Pir, Imaginative Rascal', {
      oracle_text:
        'If one or more +1/+1 counters would be put on a permanent you control, that many plus one are put on it instead.',
    });
    expect(ids(c)).toEqual(['counters']);
  });

  it('files a spellslinger commander under spellslinger', () => {
    const c = commander('Talrand, Sky Summoner', {
      oracle_text:
        'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.',
    });
    // Casts-trigger → spellslinger; the token clause also adds tokens.
    expect(ids(c)).toContain('spellslinger');
    expect(ids(c)[0]).toBe('spellslinger');
  });

  it('files a graveyard-recursion commander under reanimator', () => {
    const c = commander('Sun Titan, of the Yard', {
      oracle_text:
        'Whenever Sun Titan attacks, you may return target permanent card from your graveyard to the battlefield.',
    });
    expect(ids(c)).toContain('reanimator');
  });

  it('ranks aristocrats above lifegain for a death-drain commander', () => {
    const c = commander('Vito, Devotion Channeler', {
      oracle_text:
        'Whenever a creature you control dies, each opponent loses 1 life and you gain 1 life.',
    });
    const order = ids(c);
    expect(order[0]).toBe('aristocrats');
    expect(order).toContain('lifegain');
    expect(order.indexOf('aristocrats')).toBeLessThan(order.indexOf('lifegain'));
  });

  it('detects Voltron structurally from stacked evasion keywords', () => {
    const c = commander('Rafiq, of the Many', {
      type_line: 'Legendary Creature — Human Knight',
      keywords: ['Double strike', 'Trample'],
      oracle_text: 'Other creatures you control have flying.',
      power: '3',
    });
    expect(ids(c)).toContain('voltron');
  });

  it('files an enchantment commander under enchantress', () => {
    const c = commander('Tuvasa, the Enchanted', {
      oracle_text:
        'Whenever you cast an enchantment spell, draw a card. This ability triggers only once each turn.',
    });
    expect(ids(c)).toContain('enchantress');
  });

  it('files a landfall commander under landfall', () => {
    const c = commander('Tatyova, Benthic Druid', {
      oracle_text:
        'Whenever a land enters the battlefield under your control, you draw a card and you gain 1 life.',
    });
    expect(ids(c)).toContain('landfall');
  });

  it('files a blink/ETB payoff commander under blink', () => {
    const c = commander('Roon, of the Hidden Realm', {
      oracle_text:
        'Whenever another creature you control enters, you may exile it, then return it to the battlefield.',
    });
    expect(ids(c)).toContain('blink');
  });

  it('returns no playstyles for a vanilla beater with no signal', () => {
    const c = commander('Plain Bear', {
      type_line: 'Legendary Creature — Bear',
      oracle_text: '',
      power: '2',
      keywords: [],
    });
    expect(classifyCommanderPlaystyles(c)).toEqual([]);
  });

  it('scores are positive and sorted descending', () => {
    const c = commander('Vito, Devotion Channeler', {
      oracle_text:
        'Whenever a creature you control dies, each opponent loses 1 life and you gain 1 life.',
    });
    const matches = classifyCommanderPlaystyles(c);
    expect(matches.length).toBeGreaterThan(1);
    for (const m of matches) expect(m.score).toBeGreaterThan(0);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
  });
});

describe('commanderMatchesPlaystyle', () => {
  const tokenMaker = commander('Tana, the Bloodsower', {
    oracle_text:
      'Whenever Tana deals combat damage to a player, create a 1/1 green Saproling creature token.',
  });
  it('is true for a matching playstyle and false otherwise', () => {
    expect(commanderMatchesPlaystyle(tokenMaker, 'tokens')).toBe(true);
    expect(commanderMatchesPlaystyle(tokenMaker, 'reanimator')).toBe(false);
  });
});

describe('classifyOwnedCommanderPlaystyles (EnrichedCard adapter)', () => {
  it('classifies from a collection card’s lowercased oracle text', () => {
    const owned = {
      name: 'Vito, Devotion Channeler',
      typeLine: 'Legendary Creature — Vampire Cleric',
      // EnrichedCard.oracleText is stored lowercased.
      oracleText: 'whenever a creature you control dies, each opponent loses 1 life.',
      colorIdentity: ['B'],
    } as EnrichedCard;
    const matchIds = classifyOwnedCommanderPlaystyles(owned).map((m) => m.playstyle.id);
    expect(matchIds[0]).toBe('aristocrats');
  });

  it('returns an empty array when the card has no oracle text', () => {
    const owned = {
      name: 'No Text',
      typeLine: 'Legendary Creature',
      oracleText: undefined,
    } as EnrichedCard;
    expect(classifyOwnedCommanderPlaystyles(owned)).toEqual([]);
  });
});
