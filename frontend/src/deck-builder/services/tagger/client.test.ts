import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadTaggerData, getCardRole, cubeRole, validateCardRole } from './client';

// Minimal tagger dataset: a cost-reducer (which the generic classifier folds
// into "ramp"), a genuine ramp spell, and a removal spell. Also includes
// Expropriate mistagged 'ramp' (the real-world bug this sanity layer catches)
// and Divination for the cardDraw check.
const DATA = {
  generatedAt: '2026-06-21T00:00:00Z',
  tags: {
    'cost-reducer': ['Puresteel Paladin'],
    ramp: ['Cultivate', 'Sol Ring', 'Expropriate', 'Ramp DFC'],
    removal: ['Swords to Plowshares'],
    boardwipe: ['Wrath of God'],
    'card-advantage': ['Divination'],
  },
};

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => DATA }) as unknown as Response)
  );
  await loadTaggerData();
});

describe('cubeRole', () => {
  it('demotes a cost-reducer-only "ramp" to no role (misleading in a cube)', () => {
    expect(getCardRole('Puresteel Paladin')).toBe('ramp'); // generic tagger says ramp
    expect(cubeRole('Puresteel Paladin')).toBeNull(); // cube view: not real acceleration
  });

  it('keeps genuine ramp and unrelated roles untouched', () => {
    expect(cubeRole('Cultivate')).toBe('ramp');
    expect(cubeRole('Swords to Plowshares')).toBe('removal');
  });
});

describe('validateCardRole', () => {
  it('confirms a real ramp card whose oracle text corroborates mana production', () => {
    expect(validateCardRole({ name: 'Sol Ring', oracle_text: '{T}: Add {C}{C}.' })).toBe('ramp');
  });

  it('confirms a real ramp card whose oracle text corroborates land fetch', () => {
    expect(
      validateCardRole({
        name: 'Cultivate',
        oracle_text:
          'Search your library for up to two basic land cards, reveal them, put one onto the battlefield tapped and the other into your hand, then shuffle.',
      })
    ).toBe('ramp');
  });

  it('drops a role mistagged onto a card with no supporting evidence (Expropriate)', () => {
    // Real Expropriate text: an extra-turns/draw effect, not mana production —
    // tagged 'ramp' upstream (E77 iter-3 evidence), but the oracle text has
    // none of add-mana/cost-reduction/land-fetch.
    expect(
      validateCardRole({
        name: 'Expropriate',
        oracle_text:
          'Choose one or both — Target player takes an extra turn after this one; Draw a card.',
      })
    ).toBeNull();
    // The raw (unvalidated) tag still says ramp — this is what validateCardRole guards against.
    expect(getCardRole('Expropriate')).toBe('ramp');
  });

  it('drops a role when the cached oracle text is corrupt/mismatched for the claimed role', () => {
    // Simulates a corrupt/mismatched Scryfall record: tagged 'ramp' but the
    // text on file doesn't describe mana production, cost reduction, or land
    // fetch at all (e.g. a keyword-only line from an unrelated printing).
    expect(
      validateCardRole({ name: 'Sol Ring', oracle_text: 'Flying, vigilance, deathtouch.' })
    ).toBeNull();
  });

  it('confirms removal, boardwipe, and cardDraw with matching evidence', () => {
    expect(
      validateCardRole({
        name: 'Swords to Plowshares',
        oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
      })
    ).toBe('removal');
    expect(
      validateCardRole({
        name: 'Wrath of God',
        oracle_text: "Destroy all creatures. They can't be regenerated.",
      })
    ).toBe('boardwipe');
    expect(validateCardRole({ name: 'Divination', oracle_text: 'Draw two cards.' })).toBe(
      'cardDraw'
    );
  });

  it('falls back to trusting the tag when no oracle text is available to check', () => {
    expect(validateCardRole({ name: 'Sol Ring' })).toBe('ramp');
  });

  it('checks card_faces oracle text for DFCs (front face has no oracle_text of its own)', () => {
    expect(
      validateCardRole({
        name: 'Ramp DFC',
        card_faces: [{ oracle_text: '{T}: Add {C}{C}.' }, { oracle_text: 'Land face text' }],
      })
    ).toBe('ramp');
  });

  it('returns null for a card with no tagged role at all', () => {
    expect(validateCardRole({ name: 'Untagged Card', oracle_text: 'Draw a card.' })).toBeNull();
  });
});
