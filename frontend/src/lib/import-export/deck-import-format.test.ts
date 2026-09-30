import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  commanderCandidatesFor,
  commanderEligibleFor,
  normalizeFormat,
  partnerCandidatesFor,
} from './deck-import-format';

const card = (c: Partial<ScryfallCard> & { name: string }) => c as ScryfallCard;

const PARTNER_REMINDER = 'Partner (You can have two commanders if both have partner.)';
const thrasios = card({
  name: 'Thrasios, Triton Hero',
  type_line: 'Legendary Creature — Merfolk Wizard',
  oracle_text:
    "{4}: Scry 1, then reveal the top card of your library. If it's a land card, put it onto the battlefield tapped. Otherwise, put that card into your hand.\n" +
    PARTNER_REMINDER,
  keywords: ['Partner'],
  rarity: 'rare',
  legalities: { commander: 'legal' },
});
const tymna = card({
  name: 'Tymna the Weaver',
  type_line: 'Legendary Creature — Human Cleric',
  oracle_text:
    'Lifelink\nAt the beginning of your postcombat main phase, you may pay X life, where X is the number of opponents that were dealt combat damage this turn. If you do, draw X cards.\n' +
    PARTNER_REMINDER,
  keywords: ['Lifelink', 'Partner'],
  rarity: 'rare',
  legalities: { commander: 'legal' },
});
const solRing = card({
  name: 'Sol Ring',
  type_line: 'Artifact',
  oracle_text: '{T}: Add {C}{C}.',
  rarity: 'uncommon',
  legalities: { commander: 'legal' },
});
const uncommonCreature = card({
  name: 'Kor Skyfisher',
  type_line: 'Creature — Kor Soldier',
  oracle_text:
    'Flying\nWhen Kor Skyfisher enters, return a permanent you control to its owner’s hand.',
  rarity: 'uncommon',
  legalities: { commander: 'not_legal', paupercommander: 'legal' },
});

describe('normalizeFormat', () => {
  it('maps a detected slug onto a known format, case-insensitively', () => {
    expect(normalizeFormat('Commander')).toBe('commander');
    expect(normalizeFormat('no-such-format')).toBeNull();
    expect(normalizeFormat(undefined)).toBeNull();
  });
});

describe('commander detection', () => {
  it('uses the legendary rule for Commander and the uncommon-creature rule for PDH', () => {
    expect(commanderEligibleFor('commander')(thrasios)).toBe(true);
    expect(commanderEligibleFor('commander')(uncommonCreature)).toBe(false);
    expect(commanderEligibleFor('paupercommander')(uncommonCreature)).toBe(true);
    expect(commanderEligibleFor('paupercommander')(solRing)).toBe(false);
  });

  it('lists each eligible card once', () => {
    const names = commanderCandidatesFor([thrasios, solRing, thrasios, tymna], 'commander').map(
      (c) => c.name
    );
    expect(names).toEqual(['Thrasios, Triton Hero', 'Tymna the Weaver']);
    expect(commanderCandidatesFor(undefined, 'commander')).toEqual([]);
  });

  it('offers partners only for a commander that has a partner mechanic', () => {
    expect(partnerCandidatesFor([thrasios, tymna, solRing], thrasios).map((c) => c.name)).toEqual([
      'Tymna the Weaver',
    ]);
    expect(partnerCandidatesFor([thrasios, tymna], solRing)).toEqual([]);
    expect(partnerCandidatesFor([thrasios, tymna], null)).toEqual([]);
  });
});
