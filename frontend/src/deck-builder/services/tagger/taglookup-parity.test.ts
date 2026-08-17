// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createTagLookup } from '@spellcontrol/deck-metrics';
import { loadTaggerData, hasTag, getCardRole, isMassLandDenial, isExtraTurn } from './client';

/**
 * The frontend tagger client and `@spellcontrol/deck-metrics`'s `createTagLookup`
 * each answer "what role is this card" from the same tag data, and the backend's
 * `check_bracket` uses the package copy while every UI surface uses the client.
 *
 * If they drift, nothing throws. The bracket the AI reports simply stops
 * matching the bracket the user is looking at — and a role is a bracket input,
 * so the disagreement lands on a number, not a nuance. That is the same silent
 * failure `@spellcontrol/deck-metrics` was extracted to prevent (a server-side
 * tagger client whose module-global was null scored every deck as having no
 * roles at all), so it is worth a test rather than a comment.
 */

/** Exercises every branch of the precedence: both role folds and the ordering. */
const TAGS: Record<string, string[]> = {
  boardwipe: ['Wrath of God', 'Damnation'],
  // Also tagged boardwipe — boardwipe must win, it is the more specific claim.
  removal: ['Wrath of God', 'Swords to Plowshares'],
  ramp: ['Cultivate'],
  'cost-reducer': ['Cloud Key'],
  'mana-dork': ['Llanowar Elves'],
  'mana-rock': ['Arcane Signet'],
  'card-advantage': ['Rhystic Study'],
  tutor: ['Demonic Tutor'],
  draw: ['Divination'],
  wheel: ['Windfall'],
  looting: ['Faithless Looting'],
  cantrip: ['Ponder'],
  'mass-land-denial': ['Armageddon'],
  'extra-turn': ['Time Warp'],
  counterspell: ['Counterspell'],
  // Tagged, but with nothing the role folds recognise → no role.
  tapland: ['Jungle Hollow'],
};

const NAMES = [...new Set(Object.values(TAGS).flat()), 'A Card Nobody Tagged'];

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    async () => ({ ok: true, status: 200, json: async () => ({ tags: TAGS }) }) as Response
  );
  await loadTaggerData();
});

describe('createTagLookup matches the frontend tagger client', () => {
  const shared = createTagLookup(TAGS);

  it.each(NAMES)('agrees on getCardRole for %s', (name) => {
    expect(shared.getCardRole(name)).toBe(getCardRole(name));
  });

  it.each(NAMES)('agrees on isMassLandDenial / isExtraTurn for %s', (name) => {
    expect(shared.isMassLandDenial(name)).toBe(isMassLandDenial(name));
    expect(shared.isExtraTurn(name)).toBe(isExtraTurn(name));
  });

  it.each(Object.keys(TAGS))('agrees on hasTag for tag %s', (tag) => {
    for (const name of NAMES) {
      expect(shared.hasTag(name, tag)).toBe(hasTag(name, tag));
    }
  });

  it('pins the precedence the parity above would otherwise let both sides get wrong together', () => {
    // Boardwipe beats removal; every ramp-ish and draw-ish tag folds.
    expect(shared.getCardRole('Wrath of God')).toBe('boardwipe');
    expect(shared.getCardRole('Swords to Plowshares')).toBe('removal');
    for (const n of ['Cultivate', 'Cloud Key', 'Llanowar Elves', 'Arcane Signet']) {
      expect(shared.getCardRole(n)).toBe('ramp');
    }
    for (const n of ['Rhystic Study', 'Demonic Tutor', 'Divination', 'Windfall', 'Ponder']) {
      expect(shared.getCardRole(n)).toBe('cardDraw');
    }
    expect(shared.getCardRole('Jungle Hollow')).toBeNull();
    expect(shared.getCardRole('A Card Nobody Tagged')).toBeNull();
  });
});
