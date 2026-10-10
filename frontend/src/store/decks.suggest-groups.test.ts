import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDecksStore, type Deck, type DeckCard } from './decks';
import { useDeckHistoryStore } from './deck-history';
import { isTagsEdited } from '@/lib/deck/deck-tags';
import { planSuggestedGroups } from '@/components/deck/suggested-groups';
import { buildRows } from '@/components/deck/deck-display-rows';
import type { ScryfallCard } from '@/deck-builder/types';

vi.mock('@/lib/sync', () => ({ persistDecksState: vi.fn().mockResolvedValue(undefined) }));

const flush = () => new Promise((r) => setTimeout(r, 0));

const sc = (name: string, type_line: string) =>
  ({ name, id: `id-${name}`, type_line }) as ScryfallCard;
const slot = (slotId: string, type_line: string, extra: Partial<DeckCard> = {}): DeckCard => ({
  slotId,
  card: sc(slotId, type_line),
  allocatedCopyId: null,
  ...extra,
});

function deck(cards: DeckCard[]): Deck {
  return {
    id: 'd1',
    name: 'd1',
    source: 'manual',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards,
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#7a8a70',
    createdAt: 0,
    updatedAt: 0,
  };
}

const cardsOf = () => useDecksStore.getState().decks[0].cards;

beforeEach(async () => {
  useDecksStore.setState({ decks: [], hydrated: true });
  await flush();
});

describe('planSuggestedGroups', () => {
  it('uses the saved generator category on a generated deck, even against the card type', () => {
    // A creature the generator filed as ramp keeps its generated bucket.
    const plan = planSuggestedGroups([slot('Birds', 'Creature', { category: 'ramp' })], false);
    expect(plan.assignments).toEqual([{ slotId: 'Birds', stack: 'Ramp' }]);
    expect(plan.pending).toBe(false);
  });

  it('derives the bucket from type on a hand-built deck (no saved category)', () => {
    const plan = planSuggestedGroups(
      [slot('Forest', 'Basic Land'), slot('Bear', 'Creature')],
      true
    );
    expect(plan.assignments).toEqual([
      { slotId: 'Forest', stack: 'Lands' },
      { slotId: 'Bear', stack: 'Creatures' },
    ]);
  });

  it('skips slots the user tagged (including cleared to []) and slots already filed', () => {
    const plan = planSuggestedGroups(
      [
        slot('a', 'Creature', { tags: ['Blink'] }),
        slot('b', 'Creature', { tags: [] }),
        slot('c', 'Creature', { stack: 'Creatures' }),
        slot('d', 'Creature'),
      ],
      true
    );
    expect(plan.assignments.map((a) => a.slotId)).toEqual(['d']);
  });

  it('is pending, not wrong, while roles load for a card with no saved category', () => {
    const plan = planSuggestedGroups([slot('x', 'Sorcery')], false);
    expect(plan.pending).toBe(true);
    expect(plan.assignments).toEqual([]);
  });
});

describe('fileSuggestedStacks', () => {
  it('files in ONE write, leaves tags untouched, and the slots stay untouched', async () => {
    useDecksStore.setState({
      decks: [
        deck([
          slot('a', 'Creature'),
          slot('b', 'Basic Land'),
          slot('c', 'Creature', { tags: ['Keep'] }),
        ]),
      ],
    });
    const { persistDecksState } = await import('@/lib/sync');
    vi.mocked(persistDecksState).mockClear();
    let writes = 0;
    const unsub = useDecksStore.subscribe(() => (writes += 1));

    const { assignments } = planSuggestedGroups(cardsOf(), true);
    useDecksStore.getState().fileSuggestedStacks('d1', assignments);
    unsub();
    await flush();

    expect(writes).toBe(1);
    expect(vi.mocked(persistDecksState).mock.calls.length).toBeLessThanOrEqual(1);
    const [a, b, c] = cardsOf();
    expect(a.stack).toBe('Creatures');
    expect(b.stack).toBe('Lands');
    expect(c.stack).toBeUndefined();
    expect(c.tags).toEqual(['Keep']);
    // Not user-edited: tags still undefined, so a later tag edit starts clean.
    expect(a.tags).toBeUndefined();
    expect(isTagsEdited(a)).toBe(false);
    expect(isTagsEdited(b)).toBe(false);
  });

  it('shows under the Tags lens until the user tags the row, which wins', () => {
    useDecksStore.setState({ decks: [deck([slot('a', 'Creature')])] });
    useDecksStore.getState().fileSuggestedStacks('d1', [{ slotId: 'a', stack: 'Creatures' }]);
    const rowOf = () => buildRows(cardsOf(), 'USD', undefined)[0];
    expect(rowOf().stack).toBe('Creatures');
    expect(rowOf().tagsEdited).toBe(false);
    useDecksStore.getState().setCardTags('d1', 'cards', ['a'], []);
    expect(rowOf().tagsEdited).toBe(true);
  });

  it('undo restores the unfiled slots', () => {
    useDecksStore.setState({ decks: [deck([slot('a', 'Creature')])] });
    useDeckHistoryStore
      .getState()
      .record('d1', 'suggest groups', () =>
        useDecksStore.getState().fileSuggestedStacks('d1', [{ slotId: 'a', stack: 'Creatures' }])
      );
    expect(cardsOf()[0].stack).toBe('Creatures');
    expect(useDeckHistoryStore.getState().undo('d1')).toBe(true);
    expect(cardsOf()[0].stack).toBeUndefined();
  });
});
