// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { BinderDef, BinderFilterGroup, EnrichedCard } from '../types';

function card(name: string): EnrichedCard {
  return {
    copyId: name,
    name,
    setCode: 'TST',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: name,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
  };
}

const tagGroup: BinderFilterGroup = {
  filter: { oracleTagChips: { chips: [{ value: 'mana-rock', negate: false }], joiners: [] } },
};
const plainGroup: BinderFilterGroup = {
  filter: { typeChips: { chips: [{ value: 'artifact', negate: false }], joiners: [] } },
};
const binder = (groups: BinderFilterGroup[]): BinderDef =>
  ({ id: 'b', filterGroups: groups }) as unknown as BinderDef;

const SNAPSHOT = {
  generatedAt: '2026-01-01T00:00:00Z',
  tags: { 'mana-rock': ['Sol Ring'], ramp: ['Sol Ring', 'Llanowar Elves'] },
};

describe('card-tags pure helpers', () => {
  it('groupsUseTags / bindersUseTags detect tag rules', async () => {
    const { groupsUseTags, bindersUseTags } = await import('./card-tags');
    expect(groupsUseTags([tagGroup])).toBe(true);
    expect(groupsUseTags([plainGroup])).toBe(false);
    expect(bindersUseTags([binder([tagGroup])])).toBe(true);
    expect(bindersUseTags([binder([plainGroup])])).toBe(false);
  });

  it('cardTagLabel curates known tags and title-cases the rest', async () => {
    const { cardTagLabel } = await import('./card-tags');
    expect(cardTagLabel('mana-rock')).toBe('Mana rock');
    expect(cardTagLabel('card-advantage')).toBe('Card advantage');
    expect(cardTagLabel('lifegain')).toBe('Lifegain');
    expect(cardTagLabel('graveyard-hate')).toBe('Graveyard hate');
  });
});

describe('card-tags snapshot load + decorate', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => SNAPSHOT }) as unknown as Response)
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('decorate is a no-op before load, then attaches tags after', async () => {
    const mod = await import('./card-tags');
    const input = [card('Sol Ring'), card('Mountain')];
    // Before load: unchanged reference.
    expect(mod.decorateWithTags(input)).toBe(input);
    expect(mod.isCardTagsReady()).toBe(false);

    await mod.ensureCardTags();
    expect(mod.isCardTagsReady()).toBe(true);
    expect(mod.listCardTags()).toEqual(['mana-rock', 'ramp']);
    expect(mod.getCardTags('Sol Ring')).toEqual(['mana-rock', 'ramp']);
    expect(mod.getCardTags('Mountain')).toEqual([]);

    const out = mod.decorateWithTags(input);
    expect(out[0].tags).toEqual(['mana-rock', 'ramp']);
    expect(out[1].tags).toBeUndefined();
    expect(out[1]).toBe(input[1]); // untagged card not copied
  });

  it('failed fetch leaves tags unavailable (rules match nothing, no throw)', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 }) as unknown as Response)
    );
    const mod = await import('./card-tags');
    await mod.ensureCardTags();
    expect(mod.isCardTagsReady()).toBe(false);
    expect(mod.getCardTags('Sol Ring')).toEqual([]);
  });

  it('useCardsWithTags is a pass-through when no rule uses tags, decorates once ready', async () => {
    const mod = await import('./card-tags');
    const cards = [card('Sol Ring')];

    // usesTags=false → returns the exact input array (no load, no copy).
    const off = renderHook(({ c }) => mod.useCardsWithTags(c, false), {
      initialProps: { c: cards },
    });
    expect(off.result.current).toBe(cards);

    // usesTags=true → triggers load, then decorates with tags.
    const on = renderHook(({ c }) => mod.useCardsWithTags(c, true), {
      initialProps: { c: cards },
    });
    await waitFor(() => expect(on.result.current[0].tags).toEqual(['mana-rock', 'ramp']));
  });
});
