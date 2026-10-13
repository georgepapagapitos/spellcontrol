// @vitest-environment node
//
// E1009: a fill under tight caps seated four symmetric wipes in a go-wide
// Krenko deck. The fill is the backstop behind the EDHREC pick loop, so a board
// wipe in it must respect the role target, and a symmetric one must come last.
// Real Scryfall oracle text throughout; the roles come from the tagger the same
// way the app reads them (a name in the `boardwipe` tag + the text evidence).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  getWipeScope,
  isOneSidedWipe,
  loadTaggerData,
} from '@/deck-builder/services/tagger/client';
import { wipeQualityPenalty } from './wipeTieBreaks';

const searchCards = vi.fn();
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  searchCards: (...args: unknown[]) => searchCards(...args),
}));

import { fillWithScryfall, type FillHardGates } from './scryfallFill';

const WIPES = ['Wrath of God', 'Blasphemous Act', 'Farewell', 'Plague Wind'];
beforeAll(async () => {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      generatedAt: new Date().toISOString(),
      note: 'E1009 test slice',
      tags: { boardwipe: WIPES, ramp: ['Arcane Signet'] },
    }),
  }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
});
afterAll(() => vi.unstubAllGlobals());

const card = (name: string, type_line: string, oracle_text: string, cmc: number): ScryfallCard => ({
  id: `id-${name}`,
  oracle_id: `o-${name}`,
  name,
  cmc,
  type_line,
  oracle_text,
  color_identity: ['R', 'W'],
  keywords: [],
  rarity: 'uncommon',
  set: 'tst',
  set_name: 'Test',
  prices: { usd: '0.50' },
  legalities: { commander: 'legal' },
});

const WRATH = card(
  'Wrath of God',
  'Sorcery',
  "Destroy all creatures. They can't be regenerated.",
  4
);
const BLASPHEMOUS = card(
  'Blasphemous Act',
  'Sorcery',
  'This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature.',
  9
);
const FAREWELL = card(
  'Farewell',
  'Sorcery',
  'Choose one or more —\n• Exile all artifacts.\n• Exile all creatures.\n• Exile all enchantments.\n• Exile all graveyards.',
  6
);
const PLAGUE_WIND = card(
  'Plague Wind',
  'Sorcery',
  "Destroy all creatures you don't control. They can't be regenerated.",
  9
);
const CHIEFTAIN = card(
  'Goblin Chieftain',
  'Creature — Goblin',
  'Haste\nOther Goblin creatures you control get +1/+1 and have haste.',
  3
);
const SIGNET = card(
  'Arcane Signet',
  'Artifact',
  "{T}: Add one mana of any color in your commander's color identity.",
  2
);

const TYPE_TARGETS = { creature: 30, artifact: 8, enchantment: 6, instant: 5, sorcery: 6 };
const penalty = (c: ScryfallCard) =>
  wipeQualityPenalty(c, isOneSidedWipe, getWipeScope, TYPE_TARGETS);

beforeEach(() => {
  searchCards.mockReset();
});

const fill = (page: ScryfallCard[], count: number, gates?: FillHardGates) => {
  searchCards.mockResolvedValue({ data: page });
  return fillWithScryfall(
    '(t:creature OR t:sorcery)',
    ['R', 'W'],
    count,
    new Set(),
    new Set(),
    null,
    null,
    null,
    null,
    undefined,
    'USD',
    false,
    '',
    'prefer',
    false,
    false,
    undefined,
    undefined,
    gates,
    undefined,
    'spell'
  );
};

const names = (cards: ScryfallCard[]) => cards.map((c) => c.name);

describe('fillWithScryfall and board wipes (E1009)', () => {
  it('reads the four wipes the way the build does: Plague Wind spares the board, the rest do not', () => {
    expect(isOneSidedWipe(PLAGUE_WIND)).toBe(true);
    for (const c of [WRATH, BLASPHEMOUS, FAREWELL]) expect(isOneSidedWipe(c)).toBe(false);
    expect(penalty(PLAGUE_WIND)).toBe(0);
    expect(penalty(FAREWELL)).toBeGreaterThan(penalty(WRATH));
  });

  it('seats the one-sided wipe before a symmetric one, and the costly symmetric one last', async () => {
    const out = await fill([FAREWELL, WRATH, BLASPHEMOUS, PLAGUE_WIND], 4, {
      wipePenalty: penalty,
    });
    expect(names(out)[0]).toBe('Plague Wind');
    expect(names(out).at(-1)).toBe('Farewell');
  });

  it('puts a wipe behind the spells that cost the deck nothing', async () => {
    const out = await fill([WRATH, CHIEFTAIN, SIGNET], 3, { wipePenalty: penalty });
    expect(names(out)).toEqual(['Goblin Chieftain', 'Arcane Signet', 'Wrath of God']);
  });

  it('leaves the order alone when no plan asked for the penalty', async () => {
    const out = await fill([WRATH, CHIEFTAIN, PLAGUE_WIND], 3);
    expect(names(out)).toEqual(['Wrath of God', 'Goblin Chieftain', 'Plague Wind']);
  });

  const cap = (over: Partial<NonNullable<FillHardGates['roleCap']>>): FillHardGates => ({
    wipePenalty: penalty,
    roleCap: {
      roleTargets: { ramp: 8, removal: 8, boardwipe: 1, cardDraw: 8 },
      currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 1, cardDraw: 0 },
      ...over,
    },
  });

  it('a board-centric plan at its wipe target seats no more wipes while other spells fit', async () => {
    const out = await fill([WRATH, PLAGUE_WIND, CHIEFTAIN, SIGNET], 2, cap({ boardCentric: true }));
    expect(names(out)).toEqual(['Goblin Chieftain', 'Arcane Signet']);
  });

  it('any other plan gets one wipe past its target, not the generic two', async () => {
    const out = await fill([FAREWELL, WRATH, PLAGUE_WIND], 2, cap({ boardCentric: false }));
    // target 1 + 1 seats Plague Wind (best); the hatch then admits the least costly of the rest
    expect(names(out)).toEqual(['Plague Wind', 'Wrath of God']);
  });

  it('still ships the deck whole: the escape hatch admits a wipe when nothing else is left', async () => {
    const out = await fill([WRATH, PLAGUE_WIND], 1, cap({ boardCentric: true }));
    expect(names(out)).toEqual(['Plague Wind']);
  });

  it('the escape hatch refuses a symmetric wipe in a board-centric plan and ships the pass short', async () => {
    const out = await fill([WRATH, FAREWELL, CHIEFTAIN], 3, cap({ boardCentric: true }));
    expect(names(out)).toEqual(['Goblin Chieftain']);
  });

  it('a plan that is not board-centric still lets the hatch seat a symmetric wipe', async () => {
    const out = await fill(
      [WRATH, CHIEFTAIN],
      2,
      cap({
        boardCentric: false,
        currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 2, cardDraw: 0 },
      })
    );
    expect(names(out)).toEqual(['Goblin Chieftain', 'Wrath of God']);
  });

  it('onlyRoles leaves the other roles uncapped', async () => {
    const gates = cap({
      boardCentric: true,
      onlyRoles: ['boardwipe'],
      roleTargets: { ramp: 1, removal: 8, boardwipe: 1, cardDraw: 8 },
      currentRoleCounts: { ramp: 5, removal: 0, boardwipe: 1, cardDraw: 0 },
    });
    const out = await fill([WRATH, SIGNET, CHIEFTAIN], 2, gates);
    expect(names(out)).toEqual(['Arcane Signet', 'Goblin Chieftain']);
  });
});
