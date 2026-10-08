// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deck } from '@/store/decks';
import type { ScryfallCard } from '@/deck-builder/types';
import { useDeckHistoryStore } from '@/store/deck-history';
import {
  buildSuggestionPayload,
  isSuggestionLabelsEnabled,
  recordCubeSwap,
  recordCubeSwapShown,
  recordShown,
  recordSuggestion,
  resetSuggestionLabelsForTests,
  setSuggestionContext,
  setSuggestionLabelsEnabled,
  suggestionInputForChange,
} from './suggestion-labels';
import type { Change } from '@/lib/coach/deck-change';

const sent = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@/lib/util/analytics', () => ({
  sendBeaconPayload: (p: Record<string, unknown>) => sent.push(p),
  normalizePath: (p: string) => p,
}));

const ATRAXA = '0b0a8d28-1b0f-4d3e-9a3e-5e1a5a7a1f11';
const SORIN = '5c0d3a7e-2b1c-4f6d-8e4b-9a7c6d5e4f30';

const card = (name: string, oracle_id = `o-${name}`) => ({ name, oracle_id }) as ScryfallCard;
const slot = (name: string) => ({ slotId: `s-${name}`, card: card(name), allocatedCopyId: null });

function deck(over: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-secret-1',
    commander: card("Atraxa, Praetors' Voice", ATRAXA),
    partnerCommander: null,
    cards: [slot('Sol Ring'), slot('Early Winter')],
    generationContext: {
      generatedList: { cards: ['Sol Ring', 'Early Winter'], commanders: [] },
    },
    ...over,
  } as unknown as Deck;
}

/** Record an edit the way the editor does: a before/after snapshot pushed on the stack. */
function edit(before: Deck, after: Deck) {
  useDeckHistoryStore.setState({
    history: {
      byDeck: {
        [before.id]: {
          past: [
            ...(useDeckHistoryStore.getState().history.byDeck[before.id]?.past ?? []),
            { deckId: before.id, label: 'edit', before, after },
          ],
          future: [],
        },
      },
    },
  });
}

beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  resetSuggestionLabelsForTests();
  useDeckHistoryStore.setState({ history: { byDeck: {} } });
});

describe('buildSuggestionPayload', () => {
  const cmdr = { oracleId: ATRAXA, name: "Atraxa, Praetors' Voice", partnerOracleId: SORIN };

  it('carries only the commander, the cards, the surface, the action, the rank and the reason', () => {
    const payload = buildSuggestionPayload(
      {
        surface: 'coach:fill-gaps',
        action: 'accept',
        rank: 3,
        reason: 'fill-gaps',
        cardIn: 'Grave Pact',
        cardOut: 'Early Winter',
      },
      cmdr,
      '/decks/:id'
    );
    expect(payload).toEqual({
      name: 'suggestion',
      path: '/decks/:id',
      surface: 'coach:fill-gaps',
      action: 'accept',
      rank: 3,
      reason: 'fill-gaps',
      cmdr: ATRAXA,
      cmdrName: "Atraxa, Praetors' Voice",
      partner: SORIN,
      cardIn: 'Grave Pact',
      cardOut: 'Early Winter',
    });
  });

  it('never carries a user id, a deck id or a deck list, even when the caller holds them', () => {
    const poisoned = {
      surface: 'swap',
      action: 'accept',
      cardIn: 'Grave Pact',
      userId: 'user-77',
      deckId: 'deck-secret-1',
      deck: ['Sol Ring', 'Command Tower'],
      reason: 'fill-gaps?deck=deck-secret-1',
    } as unknown as Parameters<typeof buildSuggestionPayload>[0];
    const payload = buildSuggestionPayload(poisoned, cmdr, '/decks/:id');
    expect(Object.keys(payload).sort()).toEqual(
      [
        'action',
        'cardIn',
        'cmdr',
        'cmdrName',
        'name',
        'partner',
        'path',
        'reason',
        'surface',
      ].sort()
    );
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain('deck-secret-1');
    expect(wire).not.toContain('user-77');
    expect(wire).not.toContain('Command Tower');
  });

  it('sends an impression count and no card for a shown event', () => {
    const payload = buildSuggestionPayload(
      { surface: 'coach:all', action: 'shown', n: 500, cardIn: 'Sol Ring' },
      cmdr,
      '/x'
    );
    expect(payload).toMatchObject({ action: 'shown', n: 200 });
    expect(payload).not.toHaveProperty('cardIn');
  });
});

describe('the Settings opt-out', () => {
  it('is on by default and survives a blocked store', () => {
    expect(isSuggestionLabelsEnabled()).toBe(true);
    setSuggestionLabelsEnabled(false);
    expect(isSuggestionLabelsEnabled()).toBe(false);
    setSuggestionLabelsEnabled(true);
    expect(isSuggestionLabelsEnabled()).toBe(true);
  });

  it('suppresses every send once it is off', () => {
    setSuggestionContext(deck());
    setSuggestionLabelsEnabled(false);
    recordSuggestion({ surface: 'hidden-gems', action: 'accept', cardIn: 'Grave Pact' });
    recordShown('coach:all', 4);
    const before = deck();
    edit(before, deck({ cards: [slot('Sol Ring')] }));
    expect(sent).toEqual([]);
  });

  it('sends when it is on', () => {
    setSuggestionContext(deck());
    recordSuggestion({ surface: 'hidden-gems', action: 'accept', rank: 2, cardIn: 'Grave Pact' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ surface: 'hidden-gems', cmdr: ATRAXA, cardIn: 'Grave Pact' });
  });

  it('sends nothing without a commander', () => {
    setSuggestionContext(deck({ commander: null }));
    recordSuggestion({ surface: 'hidden-gems', action: 'accept', cardIn: 'Grave Pact' });
    expect(sent).toEqual([]);
  });
});

describe('recordShown', () => {
  it('counts a lane once per page load, and a per-card list once per card', () => {
    setSuggestionContext(deck());
    recordShown('coach:all', 4);
    recordShown('coach:all', 5);
    recordShown('swap', 3, 'Rampant Growth');
    recordShown('swap', 3, 'Rampant Growth');
    recordShown('swap', 2, 'Sol Ring');
    recordShown('coach:cuts', 0);
    expect(sent.map((p) => [p.surface, p.n])).toEqual([
      ['coach:all', 4],
      ['swap', 3],
      ['swap', 2],
    ]);
  });
});

describe('suggestionInputForChange', () => {
  const base = { id: 'x', lane: 'upgrade' } as const;
  it('reads a swap as in/out, a cut as out only and an add as in only', () => {
    const swap = { ...base, type: 'swap', name: 'Grave Pact', inName: 'Early Winter' } as Change;
    const cut = { ...base, type: 'cut', name: 'Early Winter' } as Change;
    const add = { ...base, type: 'add', name: 'Grave Pact' } as Change;
    expect(suggestionInputForChange(swap, 'coach:all', 2)).toMatchObject({
      cardIn: 'Grave Pact',
      cardOut: 'Early Winter',
      reason: 'upgrade',
      rank: 2,
    });
    expect(suggestionInputForChange(cut, 'coach:cuts', 1)).toMatchObject({
      cardIn: undefined,
      cardOut: 'Early Winter',
    });
    expect(suggestionInputForChange(add, 'coach:all', 1)).toMatchObject({
      cardIn: 'Grave Pact',
      cardOut: undefined,
    });
  });
});

describe('undo', () => {
  it('labels the undo of an accept with the same surface, rank and cards, once', () => {
    const before = deck();
    setSuggestionContext(before);
    recordSuggestion({
      surface: 'coach:upgrade',
      action: 'accept',
      rank: 2,
      reason: 'upgrade',
      cardIn: 'Grave Pact',
      cardOut: 'Early Winter',
    });
    edit(before, deck({ cards: [slot('Sol Ring'), slot('Grave Pact')] }));
    // Take the edit back, the way deck-history's undo does.
    const cmd = useDeckHistoryStore.getState().history.byDeck[before.id].past[0];
    useDeckHistoryStore.setState({
      history: { byDeck: { [before.id]: { past: [], future: [cmd] } } },
    });
    const undo = sent.filter((p) => p.action === 'undo' && p.surface === 'coach:upgrade');
    expect(undo).toHaveLength(1);
    expect(undo[0]).toMatchObject({
      surface: 'coach:upgrade',
      rank: 2,
      cardIn: 'Grave Pact',
      cardOut: 'Early Winter',
      cmdr: ATRAXA,
    });
    expect(JSON.stringify(undo[0])).not.toContain(before.id);
  });
});

describe('generation review', () => {
  it('labels cutting or swapping a generated card as a dismissal, and its undo', () => {
    const before = deck();
    setSuggestionContext(before);
    edit(before, deck({ cards: [slot('Sol Ring'), slot('Grave Pact')] }));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      surface: 'generation',
      action: 'dismiss',
      cardOut: 'Early Winter',
      cardIn: 'Grave Pact',
      cmdr: ATRAXA,
    });
    expect(JSON.stringify(sent[0])).not.toContain(before.id);

    const cmd = useDeckHistoryStore.getState().history.byDeck[before.id].past[0];
    useDeckHistoryStore.setState({
      history: { byDeck: { [before.id]: { past: [], future: [cmd] } } },
    });
    expect(sent[1]).toMatchObject({
      surface: 'generation',
      action: 'undo',
      cardOut: 'Early Winter',
    });
  });

  it('ignores cards the player added themselves and decks that were not generated', () => {
    const mine = deck({ cards: [slot('Sol Ring'), slot('Early Winter'), slot('Mine')] });
    setSuggestionContext(mine);
    edit(mine, deck({ cards: [slot('Sol Ring'), slot('Early Winter')] }));
    const hand = deck({ generationContext: null });
    edit({ ...hand, id: 'other' }, { ...deck({ cards: [slot('Sol Ring')] }), id: 'other' });
    expect(sent).toEqual([]);
  });
});

describe('cube swap labels', () => {
  beforeEach(() => {
    sent.length = 0;
    localStorage.clear();
    resetSuggestionLabelsForTests();
  });

  it('send without a deck context and carry no commander field', () => {
    recordCubeSwap({
      action: 'accept',
      rank: 2,
      reason: 'removal',
      cardIn: 'Terminate',
      cardOut: 'Doom Blade',
    });
    expect(sent).toEqual([
      {
        name: 'suggestion',
        path: window.location.pathname,
        surface: 'cube-swap',
        action: 'accept',
        rank: 2,
        reason: 'removal',
        cardIn: 'Terminate',
        cardOut: 'Doom Blade',
      },
    ]);
  });

  it('counts the candidate list once per pick', () => {
    recordCubeSwapShown(5, 'oracle-a');
    recordCubeSwapShown(5, 'oracle-a');
    recordCubeSwapShown(3, 'oracle-b');
    recordCubeSwapShown(0, 'oracle-c');
    expect(sent.map((p) => p.n)).toEqual([5, 3]);
  });

  it('sends nothing once the player opted out', () => {
    setSuggestionLabelsEnabled(false);
    recordCubeSwap({ action: 'dismiss', cardOut: 'Doom Blade' });
    recordCubeSwapShown(4, 'oracle-a');
    expect(sent).toEqual([]);
  });
});
