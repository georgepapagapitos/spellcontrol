// Guard (T171 round 3): Coach suggested Blasphemous Act (13 damage to every
// creature) to a go-wide Isshin deck; generation keeps symmetric wipes out of
// a deck that builds a board (E109/E112). Real cards (Scryfall 2026-09-29).
import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { COACH_CARDS } from './__fixtures__/coach-cards.fixtures';
import { buildCommanderProfile } from './commanderProfile';
import { dropSymmetricWipes, prefersOneSidedWipes, shaveWipeTarget } from './coachWipes';

const real = (name: string): ScryfallCard => ({ ...COACH_CARDS[name] }) as ScryfallCard;

describe('prefersOneSidedWipes', () => {
  it("reads an attack-trigger commander's deck as board-centric", () => {
    const isshin = real('Isshin, Two Heavens as One');
    const deck = ['Boros Signet', 'Swords to Plowshares', 'Counterspell'].map(real);
    expect(prefersOneSidedWipes([isshin], buildCommanderProfile(isshin), deck)).toBe(true);
  });

  it('reads a spells deck led by a non-combat commander as free to wipe', () => {
    const talrand = {
      name: 'Talrand, Sky Summoner',
      type_line: 'Legendary Creature — Merfolk Wizard',
      oracle_text:
        'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.',
      color_identity: ['U'],
    } as ScryfallCard;
    const deck = ['Counterspell', 'Harmonize', 'Swords to Plowshares', 'Mind Stone'].map(real);
    expect(prefersOneSidedWipes([talrand], buildCommanderProfile(talrand), deck)).toBe(false);
  });
});

describe('dropSymmetricWipes', () => {
  it('drops a wipe that hits your own board and keeps a one-sided one', async () => {
    const gaps = [
      { name: 'Blasphemous Act', role: 'boardwipe' },
      { name: 'Ruinous Ultimatum', role: 'boardwipe' },
      { name: 'Swords to Plowshares', role: 'removal' },
    ];
    await dropSymmetricWipes([gaps], async (names) => new Map(names.map((n) => [n, real(n)])));
    expect(gaps.map((g) => g.name)).toEqual(['Ruinous Ultimatum', 'Swords to Plowshares']);
  });

  it('keeps a wipe it cannot read', async () => {
    const gaps = [{ name: 'Blasphemous Act', role: 'boardwipe' }];
    await dropSymmetricWipes([gaps], async () => new Map());
    expect(gaps).toHaveLength(1);
  });
});

// Guard (T171 S6): Isshin was generated at "1 of 1 wipes, all roles well-covered"
// (grade A) and graded "1 of 2, needs more board wipes" (B) by the analysis after a
// land swap that moved no role count: generation shaves a board deck's wipe target,
// the analysis did not.
describe('shaveWipeTarget', () => {
  const targets = { ramp: 13, removal: 5, boardwipe: 2, cardDraw: 9 };

  it("holds Isshin's board deck one wipe fewer, as generation does", () => {
    const isshin = real('Isshin, Two Heavens as One');
    const deck = ['Boros Signet', 'Swords to Plowshares'].map(real);
    const builds = prefersOneSidedWipes([isshin], buildCommanderProfile(isshin), deck);
    expect(shaveWipeTarget(targets, builds)).toEqual({ ...targets, boardwipe: 1 });
  });

  it('leaves a deck that is free to wipe, and a target already at one, alone', () => {
    expect(shaveWipeTarget(targets, false)).toBe(targets);
    const one = { ...targets, boardwipe: 1 };
    expect(shaveWipeTarget(one, true)).toBe(one);
  });
});
