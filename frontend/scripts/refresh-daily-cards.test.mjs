// Pure-part tests for refresh-daily-cards.mjs: no network, no fs writes.
// Importing the module doesn't run main() (guarded by the isMain check).
import { describe, it, expect } from 'vitest';
import {
  isPlayablePrinting,
  colorsOf,
  foldPrinting,
  buildIndex,
  buildPool,
  redactName,
  poolEntry,
  buildPoolFile,
  buildNames,
  extendSchedule,
  daysAhead,
  addDays,
  HORIZON_DAYS,
  REPEAT_GAP_DAYS,
  POOL_MAX_RANK,
} from './refresh-daily-cards.mjs';

function printing(over = {}) {
  return {
    oracle_id: 'o-bolt',
    name: 'Lightning Bolt',
    lang: 'en',
    games: ['paper'],
    layout: 'normal',
    set_type: 'core',
    set_name: 'Limited Edition Alpha',
    released_at: '1993-08-05',
    rarity: 'common',
    colors: ['R'],
    cmc: 1,
    type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    edhrec_rank: 40,
    image_uris: { art_crop: 'https://img/bolt-lea.jpg' },
    ...over,
  };
}

describe('isPlayablePrinting', () => {
  it('keeps an English paper card from a real set', () => {
    expect(isPlayablePrinting(printing())).toBe(true);
  });

  it.each([
    ['a token', { layout: 'token' }],
    ['an art card', { layout: 'art_series' }],
    ['a digital-only printing', { digital: true }],
    ['an Arena-only printing', { games: ['arena'] }],
    ['a non-English printing', { lang: 'ja' }],
    ['an Un-set card', { set_type: 'funny' }],
    ['an oversized card', { oversized: true }],
  ])('drops %s', (_label, over) => {
    expect(isPlayablePrinting(printing(over))).toBe(false);
  });
});

describe('colorsOf', () => {
  it('orders colours WUBRG and reads faces when the card has no top-level colours', () => {
    expect(colorsOf({ colors: ['G', 'W', 'U'] })).toBe('WUG');
    expect(colorsOf({ card_faces: [{ colors: ['R'] }, { colors: ['W'] }] })).toBe('WR');
    expect(colorsOf({ colors: [] })).toBe('');
  });
});

describe('foldPrinting', () => {
  it('takes rarity, year, set and art from the earliest printing', () => {
    const map = new Map();
    foldPrinting(
      map,
      printing({ released_at: '2010-07-16', rarity: 'uncommon', set_name: 'M11', edhrec_rank: 45 })
    );
    foldPrinting(map, printing());
    const bolt = map.get('o-bolt');
    expect(bolt.rarity).toBe('common');
    expect(bolt.released).toBe('1993-08-05');
    expect(bolt.setName).toBe('Limited Edition Alpha');
    expect(bolt.art).toBe('https://img/bolt-lea.jpg');
    expect(bolt.edhrecRank).toBe(40);
  });

  it('never lets a promo stand in for the set, even on the same or an earlier date', () => {
    const map = new Map();
    foldPrinting(map, printing({ set_type: 'promo', rarity: 'rare', released_at: '1993-01-01' }));
    foldPrinting(map, printing());
    expect(map.get('o-bolt').rarity).toBe('common');
  });

  it('keeps the lowest EDHREC rank seen across printings', () => {
    const map = new Map();
    foldPrinting(map, printing({ edhrec_rank: 90 }));
    foldPrinting(map, printing({ edhrec_rank: 12, released_at: '2020-01-01' }));
    expect(map.get('o-bolt').edhrecRank).toBe(12);
  });
});

describe('buildIndex', () => {
  it('emits one compact row per name, sorted, with rarity as an index', () => {
    const map = new Map();
    foldPrinting(map, printing());
    foldPrinting(
      map,
      printing({
        oracle_id: 'o-swords',
        name: 'Swords to Plowshares',
        colors: ['W'],
        rarity: 'uncommon',
      })
    );
    const index = buildIndex(map, '2026-09-30T00:00:00.000Z');
    expect(index.cards).toEqual([
      ['Lightning Bolt', 'R', 1, 'Instant', 0, 1993],
      ['Swords to Plowshares', 'W', 1, 'Instant', 1, 1993],
    ]);
    expect(index.rarities[1]).toBe('uncommon');
  });
});

describe('redactName', () => {
  it('replaces the full name with a fixed phrase', () => {
    expect(
      redactName('When Solemn Simulacrum dies, you may draw a card.', 'Solemn Simulacrum')
    ).toBe('When this card dies, you may draw a card.');
  });

  it("covers a legend's short name and each face of a two-faced card", () => {
    expect(
      redactName(
        "Atraxa, Praetors' Voice has flying. Atraxa proliferates.",
        "Atraxa, Praetors' Voice"
      )
    ).toBe('this card has flying. this card proliferates.');
    expect(redactName('Fire deals 2 damage. Ice taps.', 'Fire // Ice')).toBe(
      'this card deals 2 damage. this card taps.'
    );
  });

  it('leaves a word that merely contains the name alone', () => {
    expect(redactName('Ashes to ashes.', 'Ash')).toBe('Ashes to ashes.');
  });
});

describe('buildPool', () => {
  it('keeps played cards with rules text and drops lands and unranked cards', () => {
    const map = new Map();
    foldPrinting(map, printing());
    foldPrinting(
      map,
      printing({ oracle_id: 'o-rare', name: 'Obscure', edhrec_rank: POOL_MAX_RANK + 1 })
    );
    foldPrinting(
      map,
      printing({ oracle_id: 'o-unranked', name: 'Unranked', edhrec_rank: undefined })
    );
    foldPrinting(
      map,
      printing({
        oracle_id: 'o-forest',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        edhrec_rank: 1,
      })
    );
    foldPrinting(
      map,
      printing({
        oracle_id: 'o-hollow',
        name: 'Jungle Hollow',
        type_line: 'Land',
        edhrec_rank: 300,
      })
    );
    foldPrinting(
      map,
      printing({
        oracle_id: 'o-mdfc',
        name: 'Town // Spell',
        type_line: 'Land — Town // Instant',
        edhrec_rank: 301,
      })
    );
    expect(buildPool(map).map((c) => c.name)).toEqual(['Lightning Bolt']);
  });
});

function poolOf(n) {
  return Array.from({ length: n }, (_, i) => ({
    name: `Card ${i}`,
    colors: 'R',
    mv: 1,
    typeLine: 'Instant',
    oracleText: `Card ${i} deals damage.`,
    edhrecRank: i + 1,
    rarity: 'common',
    released: '2000-01-01',
    setName: 'Set',
    flavor: '',
    art: '',
  }));
}

describe('extendSchedule', () => {
  it('fills today through the horizon, numbering from the epoch', () => {
    const { epoch, puzzles, added } = extendSchedule(null, poolOf(600), '2026-10-01');
    expect(epoch).toBe('2026-10-01');
    expect(added).toBe(HORIZON_DAYS + 1);
    expect(puzzles[0]).toMatchObject({ date: '2026-10-01', number: 1 });
    expect(puzzles.at(-1)).toMatchObject({
      date: addDays('2026-10-01', HORIZON_DAYS),
      number: HORIZON_DAYS + 1,
    });
    expect(puzzles[0].rulesText).not.toMatch(/Card \d+/);
  });

  it('never rewrites an existing day, past or future', () => {
    const first = extendSchedule(null, poolOf(600), '2026-10-01');
    const frozen = first.puzzles.find((p) => p.date === '2026-10-20');
    const again = extendSchedule(first, poolOf(900).reverse(), '2026-10-10');
    expect(again.epoch).toBe('2026-10-01');
    expect(again.puzzles.find((p) => p.date === '2026-10-20')).toEqual(frozen);
    expect(again.puzzles.find((p) => p.date === '2026-10-01')).toEqual(first.puzzles[0]);
    expect(again.added).toBe(9);
  });

  it('picks the same answers from the same state', () => {
    const a = extendSchedule(null, poolOf(600), '2026-10-01');
    const b = extendSchedule(null, poolOf(600), '2026-10-01');
    expect(a.puzzles.map((p) => p.name)).toEqual(b.puzzles.map((p) => p.name));
  });

  it(`doesn't repeat an answer within ${REPEAT_GAP_DAYS} days while the pool allows`, () => {
    const { puzzles } = extendSchedule(null, poolOf(600), '2026-10-01');
    expect(new Set(puzzles.map((p) => p.name)).size).toBe(puzzles.length);
  });
});

describe('daysAhead', () => {
  it('counts the days the schedule runs past today, 0 when it has run out', () => {
    const { puzzles, epoch } = extendSchedule(null, poolOf(600), '2026-10-01');
    const schedule = { epoch, puzzles };
    expect(daysAhead(schedule, '2026-10-01')).toBe(HORIZON_DAYS);
    expect(daysAhead(schedule, addDays('2026-10-01', HORIZON_DAYS + 1))).toBe(0);
    expect(daysAhead(null, '2026-10-01')).toBe(0);
  });
});

describe('server snapshots', () => {
  const card = {
    name: 'Lightning Bolt',
    colors: 'R',
    mv: 1,
    typeLine: 'Instant',
    oracleText: 'Lightning Bolt deals 3 damage to any target.',
    edhrecRank: 5,
    rarity: 'common',
    released: '1993-08-05',
    setName: 'Limited Edition Alpha',
    flavor: '',
    art: 'https://example.test/a.jpg',
  };
  it('poolEntry has no date or number and redacts the name', () => {
    const e = poolEntry(card);
    expect(e).not.toHaveProperty('date');
    expect(e).not.toHaveProperty('number');
    expect(e.rulesText).toBe('this card deals 3 damage to any target.');
    expect(e.year).toBe(1993);
    expect(e.rarity).toBe('common');
  });
  it('buildPoolFile wraps entries', () => {
    const f = buildPoolFile([card], 'now');
    expect(f).toMatchObject({ version: 1, generatedAt: 'now' });
    expect(f.cards).toHaveLength(1);
  });
  it('buildNames is sorted, unique and name-only', () => {
    const idx = {
      cards: [
        ['B', 'R', 1, 'Instant', 0, 1993],
        ['A', '', 0, 'Land', 0, 1994],
        ['B', '', 0, 'X', 0, 1],
      ],
    };
    expect(buildNames(idx, 'now')).toEqual({ version: 1, generatedAt: 'now', names: ['A', 'B'] });
  });
});
