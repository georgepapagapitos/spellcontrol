import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { DeckImportResponse, EnrichedCard } from '../types';
import { useDecksStore, type Deck } from '../store/decks';
import { useDeckHistoryStore } from '../store/deck-history';
import { setApplyingServer } from './applying-server';
import {
  buildAppendPlan,
  resolveAppendCommanderDecision,
  appendPartnerCandidatesFor,
} from './append-deck-import';

// Same mocking contract as store/decks.test.ts — the E133 centralized-heal
// subscriber fire-and-forgets a dynamic `import('./sync').then(sync =>
// sync.persistDecksState(...))` on every decks-store write it doesn't guard
// off. Mocked here so the "exactly once" assertion below is real, not a
// guess about the unmocked module's network/Capacitor internals.
const persistDecksState = vi.fn().mockResolvedValue(undefined);
vi.mock('./sync', () => ({
  persistDecksState: (...args: unknown[]) => persistDecksState(...args),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

function sc(name: string, id = name): ScryfallCard {
  return { id, name } as unknown as ScryfallCard;
}

function owned(name: string, copyId: string): EnrichedCard {
  return {
    copyId,
    name,
    scryfallId: `sf-${copyId}`,
    finish: 'nonfoil',
    foil: false,
  } as unknown as EnrichedCard;
}

function result(
  cards: ScryfallCard[],
  extra: Partial<DeckImportResponse> = {}
): DeckImportResponse {
  return {
    commander: null,
    companion: null,
    cards,
    unresolvedNames: [],
    fetchErrors: [],
    detectedFormat: 'commander',
    cardCount: cards.length,
    ...extra,
  };
}

function baseDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Test Deck',
    source: 'manual',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#7a8a70',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const ctxEmpty = { decks: [], collectionCards: [] as EnrichedCard[] };

describe('resolveAppendCommanderDecision', () => {
  it('no-commander-in-paste: format has no commander slot', () => {
    const d = resolveAppendCommanderDecision('standard', null, result([sc('Sol Ring')]));
    expect(d.kind).toBe('no-commander-in-paste');
  });

  it('no-commander-in-paste: deck already has a commander, paste specifies none', () => {
    const existing = sc('Existing Cmdr');
    const d = resolveAppendCommanderDecision('commander', existing, result([sc('Sol Ring')]));
    expect(d.kind).toBe('no-commander-in-paste');
  });

  it('matches-existing: paste names the same commander the deck already has', () => {
    const existing = sc('Korvold, Fae-Cursed King');
    const d = resolveAppendCommanderDecision(
      'commander',
      existing,
      result([sc('Sol Ring')], { commander: sc('Korvold, Fae-Cursed King', 'other-id') })
    );
    expect(d.kind).toBe('matches-existing');
    if (d.kind === 'matches-existing') expect(d.commander).toBe(existing);
  });

  it('conflicts-with-existing: paste names a DIFFERENT commander — never replaces', () => {
    const existing = sc('Korvold, Fae-Cursed King');
    const pasted = sc('The Ur-Dragon');
    const d = resolveAppendCommanderDecision(
      'commander',
      existing,
      result([sc('Sol Ring')], { commander: pasted })
    );
    expect(d.kind).toBe('conflicts-with-existing');
    if (d.kind === 'conflicts-with-existing') {
      expect(d.existing).toBe(existing);
      expect(d.pasted).toBe(pasted);
    }
  });

  it('deck-has-none: offers the explicit Commander line as the sole candidate', () => {
    const pasted = sc('Chulane, Teller of Tales');
    const d = resolveAppendCommanderDecision(
      'commander',
      null,
      result([sc('Sol Ring')], { commander: pasted })
    );
    expect(d.kind).toBe('deck-has-none');
    if (d.kind === 'deck-has-none') expect(d.candidates).toEqual([pasted]);
  });
});

describe('buildAppendPlan', () => {
  it('appends new cards, allocating owned copies', () => {
    const deck = baseDeck({
      cards: [{ slotId: 's1', card: sc('Sol Ring'), allocatedCopyId: 'c1' }],
    });
    const ctx = { decks: [deck], collectionCards: [owned('Rhystic Study', 'copy-rhystic')] };
    const plan = buildAppendPlan(
      deck,
      result([sc('Rhystic Study'), sc('Mountain')]),
      null,
      null,
      ctx
    );
    expect(plan.cards.map((c) => c.card.name)).toEqual(['Sol Ring', 'Rhystic Study', 'Mountain']);
    expect(plan.cards.find((c) => c.card.name === 'Rhystic Study')?.allocatedCopyId).toBe(
      'copy-rhystic'
    );
    expect(plan.addedCount).toBe(2);
  });

  it('routes Sideboard/Maybeboard rows to sideboard/considering, not the mainboard', () => {
    const deck = baseDeck({ format: 'standard' });
    const plan = buildAppendPlan(
      deck,
      result([sc('Lightning Bolt')], {
        sideboard: [sc('Negate')],
        considering: [sc('Dovin’s Veto')],
      }),
      null,
      null,
      ctxEmpty
    );
    expect(plan.cards.map((c) => c.card.name)).toEqual(['Lightning Bolt']);
    expect(plan.sideboard.map((c) => c.card.name)).toEqual(['Negate']);
    expect(plan.considering.map((c) => c.card.name)).toEqual(['Dovin’s Veto']);
  });

  it('considering is exempt from the copy limit — a "maybe" pile duplicate is never skipped', () => {
    const deck = baseDeck({
      cards: [{ slotId: 's1', card: sc('Sol Ring'), allocatedCopyId: null }],
      considering: [{ slotId: 's2', card: sc('Rhystic Study'), allocatedCopyId: null }],
    });
    // Sol Ring is in the real deck (singleton, max 1) — pasting it into
    // Considering must still land there, not get blocked by the mainboard
    // copy. Rhystic Study is already in Considering — pasting it again must
    // land a second time too, not get treated as a duplicate.
    const plan = buildAppendPlan(
      deck,
      result([], { considering: [sc('Sol Ring'), sc('Rhystic Study')] }),
      null,
      null,
      ctxEmpty
    );
    // deck.considering already had Rhystic Study — the two new pastes append
    // after it, unfiltered (a third Rhystic Study slot, not deduped).
    expect(plan.considering.map((c) => c.card.name)).toEqual([
      'Rhystic Study',
      'Sol Ring',
      'Rhystic Study',
    ]);
    expect(plan.skippedDuplicates).toEqual([]);
  });

  it('respects singleton copy limits: a re-pasted card already in the deck is skipped', () => {
    const deck = baseDeck({
      cards: [{ slotId: 's1', card: sc('Sol Ring'), allocatedCopyId: null }],
    });
    const plan = buildAppendPlan(
      deck,
      result([sc('Sol Ring'), sc('Mountain')]),
      null,
      null,
      ctxEmpty
    );
    expect(plan.cards.map((c) => c.card.name)).toEqual(['Sol Ring', 'Mountain']);
    expect(plan.addedCount).toBe(1);
    expect(plan.skippedDuplicates).toEqual([{ name: 'Sol Ring', count: 1 }]);
  });

  it('lets a non-singleton (constructed) format re-paste up to the format copy limit', () => {
    const deck = baseDeck({
      format: 'standard',
      cards: [
        { slotId: 's1', card: sc('Lightning Bolt'), allocatedCopyId: null },
        { slotId: 's2', card: sc('Lightning Bolt'), allocatedCopyId: null },
      ],
    });
    // 3 more copies pasted: 2 fit under the 4-copy limit, 1 is skipped.
    const plan = buildAppendPlan(
      deck,
      result([sc('Lightning Bolt'), sc('Lightning Bolt'), sc('Lightning Bolt')]),
      null,
      null,
      ctxEmpty
    );
    expect(plan.addedCount).toBe(2);
    expect(plan.skippedDuplicates).toEqual([{ name: 'Lightning Bolt', count: 1 }]);
  });

  it('never allocates the same physical copy twice within one paste', () => {
    const deck = baseDeck({ format: 'standard' });
    const ctx = { decks: [deck], collectionCards: [owned('Lightning Bolt', 'copy-1')] };
    const plan = buildAppendPlan(
      deck,
      result([sc('Lightning Bolt'), sc('Lightning Bolt')]),
      null,
      null,
      ctx
    );
    const copyIds = plan.cards.map((c) => c.allocatedCopyId);
    expect(copyIds).toEqual(['copy-1', null]);
  });

  it('deck-has-none + an explicit pick sets the commander and excludes it from the 99', () => {
    const deck = baseDeck({ commander: null });
    const chosen = sc('Chulane, Teller of Tales');
    const plan = buildAppendPlan(
      deck,
      result([chosen, sc('Sol Ring')], { commander: chosen }),
      chosen,
      null,
      ctxEmpty
    );
    expect(plan.commander).toBe(chosen);
    expect(plan.cards.map((c) => c.card.name)).toEqual(['Sol Ring']);
  });

  it('matches-existing dedupes the pasted commander line out of the main list', () => {
    const existing = sc('Korvold, Fae-Cursed King');
    const deck = baseDeck({ commander: existing });
    const plan = buildAppendPlan(
      deck,
      result([sc('Sol Ring')], { commander: sc('Korvold, Fae-Cursed King', 'dup') }),
      null,
      null,
      ctxEmpty
    );
    expect(plan.commander).toBe(existing);
    expect(plan.cards.map((c) => c.card.name)).toEqual(['Sol Ring']);
  });

  it('conflicts-with-existing keeps the current commander and adds the pasted one as a regular card', () => {
    const existing = sc('Korvold, Fae-Cursed King');
    const pastedCmdr = sc('The Ur-Dragon');
    const deck = baseDeck({ commander: existing });
    const plan = buildAppendPlan(
      deck,
      result([sc('Sol Ring')], { commander: pastedCmdr }),
      null,
      null,
      ctxEmpty
    );
    expect(plan.commander).toBe(existing);
    // The Ur-Dragon isn't in `cards` here (it was pulled into the `commander`
    // field of the response, not `cards`) — this asserts the commander field
    // itself never changed, which is the actual non-negotiable.
    expect(plan.commanderDecision.kind).toBe('conflicts-with-existing');
  });

  it('zero resolvable adds when every pasted card is already at its copy limit', () => {
    const deck = baseDeck({
      cards: [{ slotId: 's1', card: sc('Sol Ring'), allocatedCopyId: null }],
    });
    const plan = buildAppendPlan(deck, result([sc('Sol Ring')]), null, null, ctxEmpty);
    expect(plan.addedCount).toBe(0);
  });
});

describe('appendPartnerCandidatesFor', () => {
  it('is empty with no chosen commander', () => {
    expect(appendPartnerCandidatesFor(result([sc('Sol Ring')]), null)).toEqual([]);
  });
});

// ── The non-negotiable regression guard ────────────────────────────────
// A 60-card paste committed via buildAppendPlan + ONE replaceDeck call must
// fire the sync push exactly once — not once per card. Looping
// addCard/addSideboardCard/setCommander per pasted card (the anti-pattern
// this whole module exists to avoid) would instead fire the decks-store
// subscriber, and therefore persistDecksState, once per card.
describe('append commit path — persists exactly once', () => {
  beforeEach(async () => {
    setApplyingServer(false);
    useDecksStore.setState({ decks: [], hydrated: true });
    await flush();
    persistDecksState.mockClear();
  });

  it('a 60-card paste is committed with exactly one persistDecksState call', async () => {
    const deck = baseDeck();
    useDecksStore.setState({ decks: [deck] });
    await flush();
    persistDecksState.mockClear();

    const pastedCards = Array.from({ length: 60 }, (_, i) => sc(`Test Card ${i}`, `id-${i}`));
    const plan = buildAppendPlan(deck, result(pastedCards), null, null, {
      decks: useDecksStore.getState().decks,
      collectionCards: [],
    });
    expect(plan.addedCount).toBe(60);

    useDeckHistoryStore.getState().record(deck.id, `paste ${plan.addedCount} cards`, () => {
      useDecksStore.getState().replaceDeck(deck.id, {
        ...deck,
        cards: plan.cards,
        sideboard: plan.sideboard,
        considering: plan.considering,
        commander: plan.commander,
        partnerCommander: plan.partnerCommander,
        commanderAllocatedCopyId: plan.commanderAllocatedCopyId,
        partnerCommanderAllocatedCopyId: plan.partnerCommanderAllocatedCopyId,
      });
    });
    await flush();

    expect(useDecksStore.getState().decks[0].cards).toHaveLength(60);
    expect(persistDecksState).toHaveBeenCalledTimes(1);
  });
});
