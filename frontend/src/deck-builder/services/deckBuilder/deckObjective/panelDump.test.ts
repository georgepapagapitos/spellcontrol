// @vitest-environment node
//
// The LIVE_GEN dump adapter, over real Scryfall records from the objective
// fixture and dump-shaped rows the way deckGenerator.live.test.ts projects
// them.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EDHRECCard, EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';
import {
  cardFromDump,
  combosOf,
  deckFromDump,
  dumpPage,
  edhrecRowsFrom,
  resolveName,
  type PanelDump,
} from './panelDump';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(
  readFileSync(resolve(here, '__fixtures__', 'objective.fixture.json'), 'utf8')
) as { cards: ScryfallCard[] };
const BY_NAME = new Map(FIX.cards.map((c) => [c.name, c]));

function dump(over: Partial<PanelDump> = {}): PanelDump {
  return {
    commander: 'Meren of Clan Nel Toth',
    variant: 'base',
    partner: null,
    colorIdentity: ['B', 'G'],
    customization: { budgetOption: 'any', targetBracket: 'all' },
    decklist: {
      ramp: [{ name: 'Sol Ring', price_usd: '0.99', rarity: 'uncommon', set: 'cmm' }],
      lands: [{ name: 'Swamp' }, { name: 'Swamp' }],
    },
    buildReport: { dataSource: 'base' },
    ...over,
  };
}

describe('panel dumps', () => {
  it('flattens the bucket dict into the 99, one entry per copy, with the commander apart', () => {
    const deck = deckFromDump(dump(), BY_NAME);
    expect(deck.commanders.map((c) => c.name)).toEqual(['Meren of Clan Nel Toth']);
    expect(deck.cards.map((c) => c.name)).toEqual(['Sol Ring', 'Swamp', 'Swamp']);
    // The full record's oracle text, the dump's printing and price.
    expect(deck.cards[0].oracle_text).toMatch(/Add \{C\}\{C\}/);
    expect(deck.cards[0].prices.usd).toBe('0.99');
    expect(deck.cards[0].set).toBe('cmm');
  });

  it('throws on a card it cannot resolve rather than scoring a different deck', () => {
    const bad = dump({ decklist: { ramp: [{ name: 'Not A Real Card' }] } });
    expect(() => deckFromDump(bad, BY_NAME)).toThrow(/Not A Real Card/);
  });

  it('resolves curly apostrophes and front faces', () => {
    expect(resolveName(BY_NAME, 'Atraxa, Praetors’ Voice')?.name).toBe("Atraxa, Praetors' Voice");
    // A map keyed by front face (EDHREC's DFC keying) answers the full name.
    const dfc = FIX.cards.find((c) => c.name.includes(' // '))!;
    const byFront = new Map([[dfc.name.split(' // ')[0], dfc]]);
    expect(resolveName(byFront, dfc.name)?.name).toBe(dfc.name);
  });

  it("keeps the full record's fields when the dump has none", () => {
    const full = BY_NAME.get('Sol Ring')!;
    expect(cardFromDump({ name: 'Sol Ring' }, full).prices.usd).toBe(full.prices.usd);
  });

  it('reads the page a run built from: theme only when the report says so', () => {
    expect(dumpPage(dump()).theme).toBeNull();
    const themed = dump({ variant: 'aristocrats', buildReport: { dataSource: 'theme' } });
    expect(dumpPage(themed)).toMatchObject({
      theme: 'aristocrats',
      commander: 'Meren of Clan Nel Toth',
    });
  });

  it('merges non-land and land rows, keeping the higher inclusion of a repeat', () => {
    const row = (name: string, inclusion: number): EDHRECCard => ({
      name,
      sanitized: name.toLowerCase(),
      primary_type: 'Unknown',
      inclusion,
      num_decks: 10,
      synergy: 0.1,
    });
    const data = {
      cardlists: {
        allNonLand: [row('Sol Ring', 80), row('Sol Ring', 85)],
        lands: [row('Command Tower', 90)],
      },
    } as unknown as EDHRECCommanderData;
    const rows = edhrecRowsFrom(data);
    expect(rows.get('Sol Ring')?.inclusion).toBe(85);
    expect(rows.get('Command Tower')?.inclusion).toBe(90);
  });

  it('unions both runs of a spec into one combo set', () => {
    const combo = (id: string) => ({
      comboId: id,
      cards: ['A', 'B'],
      results: [],
      isComplete: true,
      missingCards: [],
      deckCount: 1,
      bracket: null,
      cardCount: 2,
    });
    const merged = combosOf(
      dump({ detectedCombos: [combo('1'), combo('2')] }),
      dump({ detectedCombos: [combo('2'), combo('3')] })
    );
    expect(merged.map((c) => c.comboId)).toEqual(['1', '2', '3']);
  });
});
