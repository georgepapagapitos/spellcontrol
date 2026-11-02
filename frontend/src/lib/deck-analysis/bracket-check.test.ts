import { HARDCODED_GAME_CHANGERS } from '@spellcontrol/deck-metrics';
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { DeckImportResponse } from '@/types/index';
import { estimateBracket } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import {
  checkPastedDeck,
  commanderOptions,
  defaultCommander,
  formatAsOf,
  GAME_CHANGERS_LIST,
  gameChangersIn,
  mainboardOf,
} from './bracket-check';

function card(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oid-${name}`,
    name,
    cmc: 3,
    type_line: 'Sorcery',
    oracle_text: '',
    color_identity: [],
    legalities: { commander: 'legal' },
    layout: 'normal',
    ...over,
  } as ScryfallCard;
}

const legend = (name: string) =>
  card(name, { type_line: 'Legendary Creature — Elf Druid', color_identity: ['G'] });

const filler = (n: number) => Array.from({ length: n }, (_, i) => card(`Filler ${i}`));

function importOf(over: Partial<DeckImportResponse>): DeckImportResponse {
  return {
    commander: null,
    companion: null,
    cards: [],
    unresolvedNames: [],
    fetchErrors: [],
    detectedFormat: 'commander',
    cardCount: 0,
    ...over,
  };
}

describe('Game Changers list', () => {
  it('is the estimator package list, sorted, so the page and the floor read one source', () => {
    expect(GAME_CHANGERS_LIST).toHaveLength(HARDCODED_GAME_CHANGERS.size);
    expect([...GAME_CHANGERS_LIST]).toEqual(
      [...GAME_CHANGERS_LIST].sort((a, b) => a.localeCompare(b))
    );
  });

  it('names the ones a list runs, once each, in list order', () => {
    const [a, b] = GAME_CHANGERS_LIST;
    expect(gameChangersIn([b, 'Sol Ring', a, a])).toEqual([a, b]);
  });

  it('writes the as-of date as a US long date regardless of timezone', () => {
    expect(formatAsOf('2026-02-09')).toBe('February 9, 2026');
  });
});

describe('commander choice', () => {
  it('prefers the commander the list named, then the legendary creatures in it', () => {
    const named = legend('Named One');
    const other = legend('Other Legend');
    const result = importOf({ commander: named, cards: [other, card('Sol Ring')] });
    expect(commanderOptions(result).map((c) => c.name)).toEqual(['Named One', 'Other Legend']);
    expect(defaultCommander(result)).toBe(named);
  });

  it('preselects the only legendary creature, and asks when there are several or none', () => {
    const one = importOf({ cards: [legend('Solo'), card('Sol Ring')] });
    expect(defaultCommander(one)?.name).toBe('Solo');
    const two = importOf({ cards: [legend('A Legend'), legend('B Legend')] });
    expect(defaultCommander(two)).toBeNull();
    expect(commanderOptions(importOf({ cards: [card('Sol Ring')] }))).toEqual([]);
  });

  it('takes the commander and partner out of the 99 by name', () => {
    const lead = legend('Lead');
    const pal = legend('Pal');
    const result = importOf({ cards: [lead, pal, card('Sol Ring')] });
    expect(mainboardOf(result, lead, null).map((c) => c.name)).toEqual(['Pal', 'Sol Ring']);
    expect(mainboardOf(result, lead, pal).map((c) => c.name)).toEqual(['Sol Ring']);
  });
});

describe('checkPastedDeck', () => {
  const commander = legend('Lead');

  it('floors a list at Bracket 4 on four Game Changers, and names them', async () => {
    const gcs = GAME_CHANGERS_LIST.slice(0, 4).map((n) => card(n));
    const out = await checkPastedDeck({
      mainboard: [...gcs, ...filler(60)],
      commanders: [commander],
      combos: null,
    });
    expect(out.estimation.bracket).toBeGreaterThanOrEqual(4);
    expect(out.estimation.hardFloors.some((f) => f.bracket === 4)).toBe(true);
    expect(out.gameChangers).toEqual(gcs.map((c) => c.name).sort((a, b) => a.localeCompare(b)));
  });

  it('floors one to three Game Changers at Bracket 3', async () => {
    const out = await checkPastedDeck({
      mainboard: [card(GAME_CHANGERS_LIST[0]), ...filler(60)],
      commanders: [commander],
      combos: null,
    });
    expect(out.estimation.bracket).toBe(3);
  });

  it('reads a list with nothing notable as Core', async () => {
    const out = await checkPastedDeck({
      mainboard: filler(60),
      commanders: [commander],
      combos: null,
    });
    expect(out.estimation.bracket).toBe(2);
    expect(out.estimation.hardFloors).toEqual([]);
    expect(out.gameChangers).toEqual([]);
  });

  it('agrees with the estimator the deck view calls', async () => {
    const mainboard = [card(GAME_CHANGERS_LIST[0]), ...filler(40)];
    const out = await checkPastedDeck({ mainboard, commanders: [commander], combos: null });
    const direct = estimateBracket(
      [...mainboard, commander].map((c) => c.name),
      [],
      3,
      undefined,
      { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
      new Set(HARDCODED_GAME_CHANGERS),
      [commander.name]
    );
    expect(out.estimation.bracket).toBe(direct.bracket);
    expect(out.estimation.softScore).toBe(direct.softScore);
  });
});
