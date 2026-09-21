import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  deckCardActions,
  tagPickActions,
  tagToggleActions,
  SECTION_ORDER,
  type DeckCardActionCtx,
} from './deck-card-actions';
import type { Row } from './deck-display-rows';

function row(over: Partial<Row> = {}): Row {
  return {
    name: 'Brago',
    qty: 1,
    price: 1,
    tags: [],
    slotIds: ['s1'],
    allocatedQty: 0,
    claimedElsewhereQty: 0,
    isPartner: false,
    card: { name: 'Brago', type_line: 'Legendary Creature' } as unknown as ScryfallCard,
    ...over,
  } as unknown as Row;
}

const keys = (ctx: DeckCardActionCtx) => deckCardActions(ctx).map((a) => a.key);
const byKey = (ctx: DeckCardActionCtx, key: string) =>
  deckCardActions(ctx).find((a) => a.key === key);

describe('deckCardActions', () => {
  it('omits an action whose handler is absent, rather than showing a dead row', () => {
    expect(keys({ row: row() })).toEqual(['remove-one']);
    expect(keys({ row: row(), onEditCard: vi.fn() })).toContain('edit-printing');
  });

  it('labels the copy actions by quantity', () => {
    expect(byKey({ row: row({ qty: 1 }) }, 'remove-one')!.label).toBe('Remove from deck');
    const many = { row: row({ qty: 3, slotIds: ['a', 'b', 'c'] }) };
    expect(byKey(many, 'remove-one')!.label).toBe('Remove one copy');
    expect(byKey(many, 'remove-all')!.label).toBe('Remove all 3 copies');
  });

  it('never offers "remove all" on a single copy', () => {
    expect(keys({ row: row({ qty: 1 }) })).not.toContain('remove-all');
  });

  it('disables "add another copy" at the same ceiling the stepper uses', () => {
    // Singleton format, one copy already in: the stepper is capped, so this is.
    const ctx = { row: row({ qty: 1 }), onSetQty: vi.fn(), isSingleton: true };
    expect(byKey(ctx, 'add-copy')!.disabled).toBe(true);
    // A basic land has no ceiling.
    const basic = {
      row: row({
        qty: 4,
        card: { name: 'Forest', type_line: 'Basic Land — Forest' } as unknown as ScryfallCard,
      }),
      onSetQty: vi.fn(),
      isSingleton: true,
    };
    expect(byKey(basic, 'add-copy')!.disabled).toBe(false);
  });

  it('drops every slot-bound action for a commander row, which has no slot', () => {
    const ctx: DeckCardActionCtx = {
      row: row({ slotIds: [] }),
      onEditCard: vi.fn(),
      onSetQty: vi.fn(),
      onRemoveCard: vi.fn(),
      onMoveToConsidering: vi.fn(),
      onSetRowTags: vi.fn(),
    };
    const k = keys(ctx);
    expect(k).not.toContain('edit-printing');
    expect(k).not.toContain('add-copy');
    expect(k).not.toContain('move-considering-one');
    expect(k).not.toContain('tag-pick');
    // The remove row is always present, but disabled with nothing to remove.
    expect(byKey(ctx, 'remove-one')!.disabled).toBe(true);
  });

  it('removes the LAST slot, so repeated removes peel copies off one end', () => {
    const onRemoveCard = vi.fn();
    const ctx = { row: row({ qty: 3, slotIds: ['a', 'b', 'c'] }), onRemoveCard };
    byKey(ctx, 'remove-one')!.run!();
    expect(onRemoveCard).toHaveBeenCalledWith('c');
  });

  it('prefers the bulk path for "remove all" so the host can show one undo', () => {
    const onSetQty = vi.fn();
    const onRemoveCard = vi.fn();
    const ctx = { row: row({ qty: 2, slotIds: ['a', 'b'] }), onSetQty, onRemoveCard };
    byKey(ctx, 'remove-all')!.run!();
    expect(onSetQty).toHaveBeenCalledWith(expect.objectContaining({ name: 'Brago' }), 0);
    expect(onRemoveCard).not.toHaveBeenCalled();
  });

  it('falls back to per-slot removal when there is no quantity handler', () => {
    const onRemoveCard = vi.fn();
    const ctx = { row: row({ qty: 2, slotIds: ['a', 'b'] }), onRemoveCard };
    byKey(ctx, 'remove-all')!.run!();
    expect(onRemoveCard.mock.calls.map((c) => c[0])).toEqual(['b', 'a']);
  });

  it('gates the collection actions on the row actually being in that state', () => {
    const handlers = { onUseOwnCopy: vi.fn(), onReleaseCopy: vi.fn() };
    expect(keys({ row: row(), ...handlers })).not.toContain('use-own-copy');
    expect(keys({ row: row(), ...handlers })).not.toContain('release-copy');
    expect(keys({ row: row({ claimedElsewhereQty: 1 }), ...handlers })).toContain('use-own-copy');
    expect(keys({ row: row({ allocatedQty: 1 }), ...handlers })).toContain('release-copy');
  });

  it('never offers to move a partner to another deck', () => {
    const onMoveToAnotherDeck = vi.fn();
    expect(keys({ row: row(), onMoveToAnotherDeck })).toContain('move-deck');
    expect(keys({ row: row({ isPartner: true }), onMoveToAnotherDeck })).not.toContain('move-deck');
  });

  it('offers BOTH tag intents: move (re-file) and add (membership)', () => {
    const onSetRowTags = vi.fn();
    const k = keys({ row: row(), onSetRowTags });
    expect(k).toContain('tag-pick');
    expect(k).toContain('tag-add');
    expect(byKey({ row: row(), onSetRowTags }, 'tag-pick')!.submenu).toBe('move');
    expect(byKey({ row: row(), onSetRowTags }, 'tag-add')!.submenu).toBe('add');
  });

  it('offers the tag picker only with a tag handler, and clear only when tagged', () => {
    expect(keys({ row: row({ tags: ['Blink'] }) })).not.toContain('tag-pick');
    const onSetRowTags = vi.fn();
    expect(keys({ row: row(), onSetRowTags })).not.toContain('tag-clear');
    const tagged = { row: row({ tags: ['Blink', 'Wincon'] }), onSetRowTags };
    expect(byKey(tagged, 'tag-clear')!.label).toBe('Take out of Blink');
  });

  it('clearing drops ONLY the primary tag, keeping the rest of the taxonomy', () => {
    const onSetRowTags = vi.fn();
    const ctx = { row: row({ tags: ['Blink', 'Wincon'] }), onSetRowTags };
    byKey(ctx, 'tag-clear')!.run!();
    expect(onSetRowTags).toHaveBeenCalledWith(['s1'], ['Wincon']);
  });

  it('gives every action a section the renderer knows how to place', () => {
    const all = deckCardActions({
      row: row({ qty: 2, slotIds: ['a', 'b'], tags: ['Blink'], allocatedQty: 1 }),
      onEditCard: vi.fn(),
      onSetQty: vi.fn(),
      onRemoveCard: vi.fn(),
      onMoveToZone: vi.fn(),
      moveZone: 'sideboard',
      onMoveToConsidering: vi.fn(),
      onReleaseCopy: vi.fn(),
      onMakeCommander: vi.fn(),
      canMakeCommander: () => true,
      onSetRowTags: vi.fn(),
    });
    expect(all.length).toBeGreaterThan(8);
    for (const a of all) expect(SECTION_ORDER).toContain(a.section);
  });
});

describe('tagToggleActions', () => {
  it('checks every tag the card carries, not just the one filing it', () => {
    const picks = tagToggleActions(
      row({ tags: ['Blink', 'Wincon'] }),
      ['Blink', 'Wincon', 'Ramp'],
      vi.fn()
    );
    expect(picks.map((p) => [p.label, p.checked])).toEqual([
      ['Blink', true],
      ['Wincon', true],
      ['Ramp', false],
    ]);
  });

  it('APPENDS without reordering, so the card keeps the section it is in', () => {
    // This is the whole difference from tagPickActions, which hoists.
    const onSetRowTags = vi.fn();
    const picks = tagToggleActions(row({ tags: ['Blink', 'Wincon'] }), ['Combo'], onSetRowTags);
    picks[0].run!();
    expect(onSetRowTags).toHaveBeenCalledWith(['s1'], ['Blink', 'Wincon', 'Combo']);
  });

  it('un-toggles a tag it already has, leaving the rest in order', () => {
    const onSetRowTags = vi.fn();
    const picks = tagToggleActions(row({ tags: ['Blink', 'Wincon'] }), ['Wincon'], onSetRowTags);
    picks[0].run!();
    expect(onSetRowTags).toHaveBeenCalledWith(['s1'], ['Blink']);
  });

  it('files an untagged card, because its first tag is necessarily primary', () => {
    const onSetRowTags = vi.fn();
    const picks = tagToggleActions(row({ tags: [] }), ['Ramp'], onSetRowTags);
    picks[0].run!();
    expect(onSetRowTags).toHaveBeenCalledWith(['s1'], ['Ramp']);
  });

  it('matches case-insensitively, so a tag is never added twice', () => {
    const picks = tagToggleActions(row({ tags: ['blink'] }), ['Blink'], vi.fn());
    expect(picks[0].checked).toBe(true);
  });
});

describe('tagPickActions', () => {
  it('checks the row’s current group, which is its FIRST tag', () => {
    const picks = tagPickActions(row({ tags: ['Blink', 'Draw'] }), ['Blink', 'Draw'], vi.fn());
    expect(picks.map((p: { label: string; checked: boolean }) => [p.label, p.checked])).toEqual([
      ['Blink', true],
      ['Draw', false],
    ]);
  });

  it('HOISTS the picked tag to primary instead of appending it', () => {
    // Appending would leave the card in its old stack and the menu would lie.
    const onSetRowTags = vi.fn();
    const picks = tagPickActions(row({ tags: ['Blink'] }), ['Draw'], onSetRowTags);
    picks[0].run!();
    expect(onSetRowTags).toHaveBeenCalledWith(['s1'], ['Draw', 'Blink']);
  });

  it('does not duplicate a tag the card already carries further down', () => {
    const onSetRowTags = vi.fn();
    const picks = tagPickActions(row({ tags: ['Blink', 'Draw'] }), ['Draw'], onSetRowTags);
    picks[0].run!();
    expect(onSetRowTags).toHaveBeenCalledWith(['s1'], ['Draw', 'Blink']);
  });

  it('matches the current group case-insensitively', () => {
    const picks = tagPickActions(row({ tags: ['blink'] }), ['Blink'], vi.fn());
    expect(picks[0].checked).toBe(true);
  });
});
