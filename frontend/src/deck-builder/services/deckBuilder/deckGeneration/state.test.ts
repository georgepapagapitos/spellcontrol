import { describe, it, expect } from 'vitest';
import { createState, addMustInclude, protectedMustIncludeNames } from './state';
import type { GenerationContext } from './state';
import type { Customization, ScryfallCard } from '@/deck-builder/types';

// Minimal fixtures — createState only reads a handful of Customization fields
// (everything else falls back via ?? / !!), so a slim cast is enough here
// rather than hand-rolling the full ~40-field Customization shape.
function makeContext(customizationOverrides: Partial<Customization> = {}): GenerationContext {
  const commander = { name: 'Test Commander', color_identity: ['G'] } as unknown as ScryfallCard;
  const customization = {
    deckFormat: 99,
    ...customizationOverrides,
  } as unknown as Customization;
  return {
    commander,
    partnerCommander: null,
    colorIdentity: ['G'],
    customization,
  };
}

describe('createState — brewLevel clamp', () => {
  it('clamps a value above 1 down to 1', () => {
    // A brewLevel > 1.5 made cardPicking.ts's inclusion multiplier go
    // negative — inverting the staples<->brew dial instead of maxing it out.
    const state = createState(makeContext({ brewLevel: 5 }));
    expect(state.cfg.brewLevel).toBe(1);
  });

  it('clamps a negative value up to 0', () => {
    const state = createState(makeContext({ brewLevel: -3 }));
    expect(state.cfg.brewLevel).toBe(0);
  });

  it('leaves an in-range value untouched', () => {
    const state = createState(makeContext({ brewLevel: 0.7 }));
    expect(state.cfg.brewLevel).toBe(0.7);
  });

  it('defaults to 0.5 when omitted', () => {
    const state = createState(makeContext({ brewLevel: undefined }));
    expect(state.cfg.brewLevel).toBe(0.5);
  });
});

describe('addMustInclude — ban conflict', () => {
  it('records a user must-include that is also banned, for the caller to disclose', () => {
    const state = createState(makeContext());
    state.bannedCards.add('Elvish Archdruid');

    addMustInclude(state, 'Elvish Archdruid', 'user');

    expect(state.mustIncludeNames).not.toContain('Elvish Archdruid');
    expect(state.mustIncludeBanConflicts).toEqual(['Elvish Archdruid']);
  });

  it('does not record a combo-sourced conflict (those skips are by design)', () => {
    const state = createState(makeContext());
    state.bannedCards.add('Elvish Archdruid');

    addMustInclude(state, 'Elvish Archdruid', 'combo');

    expect(state.mustIncludeBanConflicts).toEqual([]);
  });

  it('adds a non-banned must-include normally', () => {
    const state = createState(makeContext());

    addMustInclude(state, 'Sol Ring', 'user');

    expect(state.mustIncludeNames).toEqual(['Sol Ring']);
    expect(state.mustIncludeBanConflicts).toEqual([]);
  });
});

describe('createState — Game Changer headroom', () => {
  const gc = (name: string) => ({ name }) as unknown as ScryfallCard;

  it('reads the deck as it stands, so a repair swap counts', () => {
    const state = createState(makeContext({ gameChangerLimit: 1 }));
    state.gameChangerNames = new Set(['Cyclonic Rift', "Thassa's Oracle"]);
    expect(state.cfg.gameChangerLimitReached?.()).toBe(false);
    state.categories.boardWipes.push(gc('Cyclonic Rift'));
    expect(state.cfg.gameChangerLimitReached?.()).toBe(true);
    expect(state.cfg.isGameChanger?.("Thassa's Oracle")).toBe(true);
    state.categories.boardWipes.pop();
    expect(state.cfg.gameChangerLimitReached?.()).toBe(false);
  });

  it('is never reached without a limit', () => {
    const state = createState(makeContext({ gameChangerLimit: 'unlimited' }));
    state.gameChangerNames = new Set(['Cyclonic Rift']);
    state.categories.boardWipes.push(gc('Cyclonic Rift'));
    expect(state.cfg.gameChangerLimitReached?.()).toBe(false);
  });

  it('is reached immediately at "none"', () => {
    const state = createState(makeContext({ gameChangerLimit: 'none' }));
    expect(state.cfg.gameChangerLimitReached?.()).toBe(true);
  });
});

// E1005: eviction phases protect every card the player asked for, not only the
// typed and temporary lists.
describe('protectedMustIncludeNames', () => {
  const seated = (name: string, source: 'user' | 'deck' | 'combo' | 'dial') =>
    ({ name, isMustInclude: true, mustIncludeSource: source }) as unknown as ScryfallCard;

  it('covers typed, temporary, include-list and build-from-deck picks, lower-cased', () => {
    const state = createState(
      makeContext({
        mustIncludeCards: ['Sol Ring'],
        tempMustIncludeCards: ["Thassa's Oracle"],
      })
    );
    addMustInclude(state, 'Rhystic Study', 'user'); // an include list
    addMustInclude(state, 'Cyclonic Rift', 'deck'); // build-from-deck
    const names = protectedMustIncludeNames(state);
    for (const n of ['sol ring', "thassa's oracle", 'rhystic study', 'cyclonic rift']) {
      expect(names.has(n)).toBe(true);
    }
  });

  it('covers a seated forced card by its flag, and leaves a Staples/Synergy dial seed evictable', () => {
    const state = createState(makeContext());
    state.categories.utility.push(seated('Mystic Remora', 'user'), seated('Arcane Signet', 'dial'));
    const names = protectedMustIncludeNames(state);
    expect(names.has('mystic remora')).toBe(true);
    expect(names.has('arcane signet')).toBe(false);
  });
});
