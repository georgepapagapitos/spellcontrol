import { describe, it, expect } from 'vitest';
import { applyAction, createPlaytestState } from './reducer';
import { toPublicBoard, toProjectedCard, toPublicTicker, TICKER_LIMIT } from './projection';
import type { GameLogEntry } from './game-log';
import type { PlaytestCard, PlaytestState } from './types';

function card(id: string, overrides: Partial<PlaytestCard> = {}): PlaytestCard {
  return {
    id,
    name: `card-${id}`,
    oracleId: `oracle-${id}`,
    scryfallId: `scry-${id}`,
    imageUrl: `https://img.example/${id}.png`,
    backImageUrl: `https://img.example/${id}-back.png`,
    manaValue: 3,
    typeLine: 'Creature — Bear',
    ...overrides,
  };
}

function deck(n: number): PlaytestCard[] {
  return Array.from({ length: n }, (_, i) => card(`lib${i}`));
}

function baseState(overrides: Partial<PlaytestState> = {}): PlaytestState {
  const s = createPlaytestState({ library: deck(10), seed: 1, openingHandSize: 3 });
  return { ...s, ...overrides };
}

describe('toPublicBoard', () => {
  it('never leaks hand or library contents', () => {
    const s = baseState({
      zones: {
        library: [card('secretlib', { name: 'Secret Library Card' })],
        hand: [card('secrethand', { name: 'Secret Hand Card' })],
        graveyard: [],
        exile: [],
        sideboard: [],
        command: [],
      },
    });
    const board = toPublicBoard(s, 0);
    const serialized = JSON.stringify(board);
    expect(serialized).not.toContain('Secret Library Card');
    expect(serialized).not.toContain('Secret Hand Card');
    expect(serialized).not.toContain('secretlib');
    expect(serialized).not.toContain('secrethand');
  });

  it('reports hand/library as counts only', () => {
    const s = baseState({
      zones: {
        library: deck(5),
        hand: [card('h0'), card('h1')],
        graveyard: [],
        exile: [],
        sideboard: [],
        command: [],
      },
    });
    const board = toPublicBoard(s, 0);
    expect(board.handCount).toBe(2);
    expect(board.libraryCount).toBe(5);
  });

  it('redacts a face-down battlefield card to position/tapped/counters, not identity', () => {
    const s = baseState({
      battlefield: [
        {
          card: card('morph1', { name: 'Willbender' }),
          tapped: true,
          counters: { '+1/+1': 2 },
          stickers: ['flying'],
          x: 0.25,
          y: 0.5,
          faceDown: true,
        },
      ],
    });
    const board = toPublicBoard(s, 0);
    const bf = board.battlefield[0];
    expect(bf.faceDown).toBe(true);
    expect(bf.tapped).toBe(true);
    expect(bf.x).toBe(0.25);
    expect(bf.y).toBe(0.5);
    expect(bf.counters).toEqual({ '+1/+1': 2 });
    expect(bf.stickers).toEqual(['flying']);
    // The instance id is masked, not passed through — see `maskId`.
    expect(bf.card.id).not.toBe('morph1');
    expect(bf.card.id).toMatch(/^fd-/);
    // …and stable within a page, so it still works as a render key.
    expect(toPublicBoard(s, 0).battlefield[0].card.id).toBe(bf.card.id);

    const serialized = JSON.stringify(board);
    expect(serialized).not.toContain('Willbender');
    expect(serialized).not.toContain('morph1');
    expect(serialized).not.toContain('scry-morph1');
    expect(serialized).not.toContain('oracle-morph1');
  });

  it('masks a face-down commander id (which embeds the Scryfall id) and remaps attachments to it', () => {
    const s = baseState({
      battlefield: [
        {
          card: card('cmd-scryfall-uuid-1234', { name: 'Kenrith' }),
          tapped: false,
          counters: {},
          stickers: [],
          x: 0.1,
          y: 0.1,
          faceDown: true,
        },
        {
          card: card('aura1', { name: 'Pacifism' }),
          tapped: false,
          counters: {},
          stickers: [],
          x: 0.2,
          y: 0.2,
          faceDown: false,
          attachedTo: 'cmd-scryfall-uuid-1234',
        },
      ],
    });
    const board = toPublicBoard(s, 0);
    const [commander, aura] = board.battlefield;
    expect(JSON.stringify(board)).not.toContain('scryfall-uuid-1234');
    expect(commander.card.id).toMatch(/^fd-/);
    // The aura still points at the (masked) commander, so the attachment renders.
    expect(aura.attachedTo).toBe(commander.card.id);
    // A face-up host is referenced by its real id — masking is face-down only.
    const faceUp = toPublicBoard(
      baseState({ battlefield: s.battlefield.map((b) => ({ ...b, faceDown: false })) }),
      0
    );
    expect(faceUp.battlefield[1].attachedTo).toBe('cmd-scryfall-uuid-1234');
  });

  it('projects a face-up card identity normally', () => {
    const s = baseState({
      battlefield: [
        {
          card: card('bear1', { name: 'Grizzly Bears' }),
          tapped: false,
          counters: {},
          stickers: [],
          x: 0.1,
          y: 0.1,
          faceDown: false,
        },
      ],
    });
    const board = toPublicBoard(s, 0);
    expect(board.battlefield[0].card.name).toBe('Grizzly Bears');
    expect(board.battlefield[0].card.scryfallId).toBe('scry-bear1');
  });

  it('projects a face-up transformed DFC identity normally (showBackFace is public)', () => {
    const s = baseState({
      battlefield: [
        {
          card: card('dfc1', { name: 'Delver of Secrets' }),
          tapped: false,
          counters: {},
          stickers: [],
          x: 0.1,
          y: 0.1,
          faceDown: false,
          showBackFace: true,
        },
      ],
    });
    const board = toPublicBoard(s, 0);
    const bf = board.battlefield[0];
    expect(bf.showBackFace).toBe(true);
    expect(bf.card.name).toBe('Delver of Secrets');
    expect(bf.card.scryfallId).toBe('scry-dfc1');
  });

  it('strips image URLs from every projected card', () => {
    const s = baseState({
      battlefield: [
        {
          card: card('imgbf'),
          tapped: false,
          counters: {},
          stickers: [],
          x: 0,
          y: 0,
          faceDown: false,
        },
      ],
      zones: {
        library: [],
        hand: [],
        graveyard: [card('imggy')],
        exile: [card('imgex')],
        sideboard: [],
        command: [card('imgcmd')],
      },
    });
    const board = toPublicBoard(s, 0);
    const serialized = JSON.stringify(board);
    expect(serialized).not.toContain('img.example');
    expect(serialized).not.toContain('imageUrl');
    expect(serialized).not.toContain('backImageUrl');
  });

  it('omits the undo stack — local bookkeeping, never shared', () => {
    const s = baseState({
      past: [
        {
          ...baseState(),
          zones: { library: [], hand: [], graveyard: [], exile: [], sideboard: [], command: [] },
        },
      ],
    });
    const board = toPublicBoard(s, 0);
    expect(JSON.stringify(board)).not.toContain('"past"');
    expect(board).not.toHaveProperty('past');
  });

  it('carries public per-player fields and the seat index', () => {
    const s = baseState({
      turn: 4,
      life: 33,
      playerCounters: { energy: 2 },
      manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commanderTax: { cmdr1: 2 },
      monarch: true,
      initiative: false,
      citysBlessing: true,
    });
    const board = toPublicBoard(s, 2);
    expect(board.seat).toBe(2);
    expect(board.turn).toBe(4);
    expect(board.life).toBe(33);
    expect(board.playerCounters).toEqual({ energy: 2 });
    expect(board.manaPool).toEqual({ W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 });
    expect(board.commanderTax).toEqual({ cmdr1: 2 });
    expect(board.monarch).toBe(true);
    expect(board.citysBlessing).toBe(true);
  });

  it('is pure: repeated calls on the same input deep-equal', () => {
    const s = baseState({
      battlefield: [
        {
          card: card('pure1'),
          tapped: false,
          counters: { charge: 1 },
          stickers: ['big'],
          x: 0.3,
          y: 0.4,
          faceDown: true,
        },
      ],
    });
    const a = toPublicBoard(s, 1);
    const b = toPublicBoard(s, 1);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

function logEntry(overrides: Partial<GameLogEntry> = {}): GameLogEntry {
  return { seq: 1, turn: 1, kind: 'play', text: 'Grizzly Bears played from hand', ...overrides };
}

describe('toPublicBoard — the revealed library', () => {
  it('leaves the field off entirely while the library is private', () => {
    expect(toPublicBoard(baseState(), 1).revealedLibrary).toBeUndefined();
    expect(toPublicBoard(baseState({ libraryReveal: 'none' }), 1).revealedLibrary).toBeUndefined();
    // An empty library has nothing to show even in a revealing mode.
    const emptied = baseState({ libraryReveal: 'all' });
    emptied.zones.library = [];
    expect(toPublicBoard(emptied, 1).revealedLibrary).toBeUndefined();
  });

  it('sends NOTHING for the Me audience — private at the wire, not in the UI', () => {
    const state = baseState({ libraryReveal: 'top-me' });
    const board = toPublicBoard(state, 1);
    expect(board.revealedLibrary).toBeUndefined();
    // The card's name must not reach an opponent's client by any other
    // route either: filtering it in their UI would still ship it to them.
    expect(JSON.stringify(board)).not.toContain(state.zones.library[0].name);
  });

  it('shows exactly the top card while playing with the top revealed', () => {
    const state = baseState({ libraryReveal: 'top' });
    const shown = toPublicBoard(state, 1).revealedLibrary;
    expect(shown).toHaveLength(1);
    expect(shown?.[0].id).toBe(state.zones.library[0].id);
  });

  it('shows the whole library, in order, while revealing all of it', () => {
    const state = baseState({ libraryReveal: 'all' });
    const shown = toPublicBoard(state, 1).revealedLibrary;
    expect(shown?.map((c) => c.id)).toEqual(state.zones.library.map((c) => c.id));
  });

  it('is read off the live library, so a draw changes what the table sees', () => {
    const state = baseState({ libraryReveal: 'top' });
    const was = toPublicBoard(state, 1).revealedLibrary?.[0].id;
    const drawn = { ...state, zones: { ...state.zones, library: state.zones.library.slice(1) } };
    const now = toPublicBoard(drawn, 1).revealedLibrary?.[0].id;
    expect(now).not.toBe(was);
    expect(now).toBe(drawn.zones.library[0].id);
  });

  it('projects cards, so no image url rides along with them', () => {
    const shown = toPublicBoard(baseState({ libraryReveal: 'all' }), 1).revealedLibrary ?? [];
    for (const c of shown) expect(c).not.toHaveProperty('imageUrl');
  });
});

describe('toPublicTicker', () => {
  it('keeps public kinds and projects seq/kind/text/cardName only', () => {
    const ticker = toPublicTicker([
      logEntry({ seq: 1, kind: 'turn', text: 'Turn 2 begins', verdict: 'consent' }),
      logEntry({ seq: 2, kind: 'play', text: 'Sol Ring played from hand', cardName: 'Sol Ring' }),
      logEntry({ seq: 3, kind: 'draw', text: 'Drew 1 card' }),
    ]);
    expect(ticker).toEqual([
      { seq: 1, kind: 'turn', text: 'Turn 2 begins' },
      { seq: 2, kind: 'play', text: 'Sol Ring played from hand', cardName: 'Sol Ring' },
      { seq: 3, kind: 'draw', text: 'Drew 1 card' },
    ]);
  });

  it('drops private kinds (life/counter/mana/resistance)', () => {
    const ticker = toPublicTicker([
      logEntry({ seq: 1, kind: 'life', text: 'Your life: 40 → 37' }),
      logEntry({ seq: 2, kind: 'counter', text: 'You: poison 0 → 1' }),
      logEntry({ seq: 3, kind: 'mana', text: 'White mana: 0 → 1' }),
      logEntry({ seq: 4, kind: 'resistance', text: 'Opponent attacks for 6' }),
    ]);
    expect(ticker).toEqual([]);
  });

  it('drops a zone move whose card never touched a public zone (tutor/bottoming)', () => {
    const ticker = toPublicTicker([
      logEntry({
        seq: 1,
        kind: 'zone-move',
        text: 'Demonic Tutor Target: library → hand',
        cardName: 'Demonic Tutor Target',
        from: 'library',
        to: 'hand',
      }),
      logEntry({
        seq: 2,
        kind: 'zone-move',
        text: 'Bottomed Card: hand → library',
        cardName: 'Bottomed Card',
        from: 'hand',
        to: 'library',
      }),
    ]);
    expect(ticker).toEqual([]);
  });

  it('keeps a zone move with a public endpoint on either side', () => {
    const entries: GameLogEntry[] = [
      logEntry({
        seq: 1,
        kind: 'zone-move',
        text: 'A: hand → graveyard',
        from: 'hand',
        to: 'graveyard',
      }),
      logEntry({
        seq: 2,
        kind: 'zone-move',
        text: 'B: battlefield → hand',
        from: 'battlefield',
        to: 'hand',
      }),
      logEntry({
        seq: 3,
        kind: 'zone-move',
        text: 'C: graveyard → library',
        from: 'graveyard',
        to: 'library',
      }),
    ];
    expect(toPublicTicker(entries).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('drops a zone move missing endpoints (pre-field persisted entry — cannot prove it was public)', () => {
    expect(
      toPublicTicker([logEntry({ seq: 1, kind: 'zone-move', text: 'Old Entry: hand → graveyard' })])
    ).toEqual([]);
  });

  it('caps to the trailing TICKER_LIMIT lines', () => {
    const entries = Array.from({ length: TICKER_LIMIT + 10 }, (_, i) =>
      logEntry({ seq: i + 1, kind: 'draw', text: `Drew ${i + 1}` })
    );
    const ticker = toPublicTicker(entries);
    expect(ticker).toHaveLength(TICKER_LIMIT);
    expect(ticker[0].seq).toBe(11);
    expect(ticker[ticker.length - 1].seq).toBe(TICKER_LIMIT + 10);
  });
});

describe('toProjectedCard', () => {
  it('drops image fields but keeps other printed metadata', () => {
    const projected = toProjectedCard(card('c1'));
    expect(projected).toEqual({
      id: 'c1',
      name: 'card-c1',
      oracleId: 'oracle-c1',
      scryfallId: 'scry-c1',
      manaValue: 3,
      typeLine: 'Creature — Bear',
      isToken: undefined,
    });
    expect(projected).not.toHaveProperty('imageUrl');
    expect(projected).not.toHaveProperty('backImageUrl');
  });

  it('carries printed power/toughness through — a permanent body is public', () => {
    const projected = toProjectedCard(card('c2', { power: '2', toughness: '2' }));
    expect(projected.power).toBe('2');
    expect(projected.toughness).toBe('2');
  });
});

describe('toPublicBoard — power/toughness', () => {
  it('projects printed power/toughness and the pt modifier for a face-up permanent', () => {
    const s = baseState({
      battlefield: [
        {
          card: card('body1', { name: 'Grizzly Bears', power: '2', toughness: '2' }),
          tapped: false,
          counters: { '+1/+1': 1 },
          stickers: [],
          x: 0.1,
          y: 0.1,
          faceDown: false,
          pt: { power: 1, toughness: 0 },
        },
      ],
    });
    const bf = toPublicBoard(s, 0).battlefield[0];
    expect(bf.card.power).toBe('2');
    expect(bf.card.toughness).toBe('2');
    expect(bf.pt).toEqual({ power: 1, toughness: 0 });
  });

  it('never projects power/toughness or the pt modifier for a face-down permanent', () => {
    const s = baseState({
      battlefield: [
        {
          card: card('morph2', { name: 'Willbender', power: '2', toughness: '2' }),
          tapped: false,
          counters: {},
          stickers: [],
          x: 0.1,
          y: 0.1,
          faceDown: true,
          pt: { power: 3, toughness: 3 },
        },
      ],
    });
    const bf = toPublicBoard(s, 0).battlefield[0];
    expect(bf.card).not.toHaveProperty('power');
    expect(bf.card).not.toHaveProperty('toughness');
    expect(bf.pt).toBeUndefined();
    expect(JSON.stringify(bf)).not.toContain('"pt"');
  });

  it('renders a board from before these fields existed exactly as before — no power/toughness, no pt, no crash', () => {
    // An older client's projection is missing `power`/`toughness`/`pt`
    // entirely (not merely undefined) — this is that shape, hand-built
    // rather than through `card()`/`toProjectedCard`.
    const oldBoard = toPublicBoard(
      baseState({
        battlefield: [
          {
            card: { id: 'old1', name: 'Grizzly Bears' },
            tapped: false,
            counters: {},
            stickers: [],
            x: 0.1,
            y: 0.1,
            faceDown: false,
          },
        ],
      }),
      0
    );
    const bf = oldBoard.battlefield[0];
    expect(bf.card.power).toBeUndefined();
    expect(bf.card.toughness).toBeUndefined();
    expect(bf.pt).toBeUndefined();
  });
});

/**
 * Exile is otherwise fully public, so a face-down card in it is the one
 * thing there that must not reach the table — redacted the same way a
 * face-down permanent is, rather than simply omitted (it is visibly THERE).
 */
describe('toPublicBoard — face-down exile', () => {
  function exiled(faceDown: boolean) {
    const s = baseState();
    const [a, b] = s.zones.library;
    return {
      ...s,
      zones: { ...s.zones, exile: [a, b] },
      faceDownExile: faceDown ? [a.id] : [],
    };
  }

  it('passes an ordinary exiled card through in full', () => {
    // Read the names off the fixture — createPlaytestState shuffles, so
    // which cards land in exile is not fixed.
    const state = exiled(false);
    const board = toPublicBoard(state, 1);
    expect(board.exile.map((c) => c.name)).toEqual(state.zones.exile.map((c) => c.name));
  });

  it('redacts the face-down one to a masked id and nothing else', () => {
    const state = exiled(true);
    const board = toPublicBoard(state, 1);
    expect(board.exile).toHaveLength(2);
    const [hiddenCard, openCard] = board.exile;
    expect(hiddenCard.name).toBeUndefined();
    expect(hiddenCard.oracleId).toBeUndefined();
    expect(hiddenCard.scryfallId).toBeUndefined();
    expect(openCard.name).toBe(state.zones.exile[1].name);
    // The real id is masked too, so it can't be matched against anything.
    expect(hiddenCard.id).not.toBe(state.zones.exile[0].id);
    expect(JSON.stringify(board)).not.toContain(state.zones.exile[0].name);
  });

  it('keeps the count honest — a hidden card is still a card in exile', () => {
    expect(toPublicBoard(exiled(true), 1).exile).toHaveLength(2);
  });
});

describe('toPublicBoard — playing with the hand revealed', () => {
  it('shows the whole live hand, including a card drawn after turning it on', () => {
    const on = applyAction(baseState(), { type: 'SET_HAND_REVEALED', revealed: true });
    const drawn = applyAction(on, { type: 'DRAW' });
    expect(toPublicBoard(drawn, 1).revealed?.map((c) => c.id)).toEqual(
      drawn.zones.hand.map((c) => c.id)
    );
  });

  it('shows nothing from hand while it is off', () => {
    expect(toPublicBoard(baseState(), 1).revealed).toEqual([]);
  });
});
