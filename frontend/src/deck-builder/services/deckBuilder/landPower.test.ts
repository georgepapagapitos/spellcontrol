import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isColorlessOnlyLand, landPowerScore, untappedConditionOutOfReach } from './landPower';
import type { ScryfallCard } from '@/deck-builder/types';

const card = (p: Partial<ScryfallCard>): ScryfallCard => ({ name: 'x', ...p }) as ScryfallCard;
const WU = new Set(['W', 'U']);

// A brand-new dual EDHREC has never seen — the whole point of the score is that
// it rates this on merit, not popularity. No EDHREC field is even an input.
const newUntappedDual = card({
  name: 'Some 2026 Dual',
  type_line: 'Land',
  produced_mana: ['W', 'U'],
  oracle_text: '{T}: Add {W} or {U}.',
});
const tappedGuildgate = card({
  name: 'Azorius Gate',
  type_line: 'Land — Island Plains',
  produced_mana: ['W', 'U'],
  oracle_text: 'This land enters the battlefield tapped. {T}: Add {W} or {U}.',
});
const plains = card({ name: 'Plains', type_line: 'Basic Land — Plains', produced_mana: ['W'] });
const offColorTapland = card({
  name: 'Off-color Gate',
  type_line: 'Land',
  produced_mana: ['B'],
  oracle_text: 'This land enters the battlefield tapped. {T}: Add {B}.',
});
const fetchland = card({
  name: 'Some Fetch',
  type_line: 'Land',
  oracle_text:
    '{T}, Pay 1 life, Sacrifice this land: Search your library for a Plains or Island card.',
});
const utilityLand = card({
  name: 'Some Utility Land',
  type_line: 'Land',
  produced_mana: ['C'],
  oracle_text: '{T}: Add {C}. {2}, {T}: Draw a card.',
});

describe('landPowerScore', () => {
  it('ranks untapped fixer > tapped dual > basic > off-color junk', () => {
    expect(landPowerScore(newUntappedDual, WU)).toBeGreaterThan(
      landPowerScore(tappedGuildgate, WU)
    );
    expect(landPowerScore(tappedGuildgate, WU)).toBeGreaterThan(landPowerScore(plains, WU));
    expect(landPowerScore(plains, WU)).toBeGreaterThan(landPowerScore(offColorTapland, WU));
    expect(landPowerScore(offColorTapland, WU)).toBe(0);
  });

  it('rates a new dual in the strong band despite zero popularity', () => {
    expect(landPowerScore(newUntappedDual, WU)).toBeGreaterThanOrEqual(40);
  });

  it('rewards fetches and rewards colorless utility above off-color junk', () => {
    expect(landPowerScore(fetchland, WU)).toBeGreaterThan(landPowerScore(newUntappedDual, WU));
    expect(landPowerScore(utilityLand, WU)).toBeGreaterThan(0);
  });

  it('caps basics as the manabase floor and scores non-lands 0', () => {
    expect(landPowerScore(plains, WU)).toBeLessThanOrEqual(20);
    expect(landPowerScore(card({ name: 'Bolt', type_line: 'Instant' }), WU)).toBe(0);
  });

  it('penalizes a painland below a clean dual in a low-color deck, but keeps it strong at 5c', () => {
    const cityOfBrass = card({
      name: 'City of Brass',
      type_line: 'Land',
      produced_mana: ['W', 'U', 'B', 'R', 'G'],
      oracle_text:
        'Whenever City of Brass becomes tapped, it deals 1 damage to you. {T}: Add one mana of any color.',
    });
    // In a 2-color deck it clamps to 2 colors and the ping makes it strictly
    // worse than a clean untapped dual — must not out-score one.
    expect(landPowerScore(cityOfBrass, WU)).toBeLessThan(landPowerScore(newUntappedDual, WU));
    // In 5 colors the fixing is worth the ping — it stays a strong pick.
    const WUBRG = new Set(['W', 'U', 'B', 'R', 'G']);
    expect(landPowerScore(cityOfBrass, WUBRG)).toBeGreaterThanOrEqual(60);
  });
});

describe('E1004: colorless-only and out-of-reach untapped lands, on real oracle text', () => {
  const fx = JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'edgar-lands.fixture.json'),
      'utf8'
    )
  ) as { cards: ScryfallCard[] };
  const byName = (n: string) => fx.cards.find((c) => c.name === n)!;

  it('reads the spend-restricted rainbow lands and plain utility as colorless-only', () => {
    for (const n of [
      'Voldaren Estate',
      'Unclaimed Territory',
      'Secluded Courtyard',
      'Reliquary Tower',
      "Rogue's Passage",
    ]) {
      expect(isColorlessOnlyLand(byName(n)), n).toBe(true);
    }
  });

  it('reads the creature-restricted rainbow lands as fixing in a typal deck', () => {
    for (const n of ['Voldaren Estate', 'Unclaimed Territory', 'Secluded Courtyard']) {
      expect(isColorlessOnlyLand(byName(n), { typalFixing: true }), n).toBe(false);
    }
    // plain utility stays colorless in a typal deck
    for (const n of ['Reliquary Tower', "Rogue's Passage"]) {
      expect(isColorlessOnlyLand(byName(n), { typalFixing: true }), n).toBe(true);
    }
  });

  it('does not read fixers, colored utility, rainbow lands or fetches as colorless-only', () => {
    for (const n of [
      'Blood Crypt',
      'Caves of Koilos',
      'Takenuma, Abandoned Mire',
      'Bojuka Bog',
      'Command Tower',
      'Bloodstained Mire',
    ]) {
      expect(isColorlessOnlyLand(byName(n)), n).toBe(false);
    }
  });

  it('flags only an untapped condition that asks for something other than lands', () => {
    for (const n of ['Dragonskull Summit', 'Isolated Chapel', 'Luxury Suite', 'Blood Crypt']) {
      expect(untappedConditionOutOfReach(byName(n)), n).toBe(false);
    }
    for (const n of ['Mines of Moria', 'Temple of the Dragon Queen', 'Fortified Beachhead']) {
      expect(untappedConditionOutOfReach(byName(n)), n).toBe(true);
    }
  });
});
