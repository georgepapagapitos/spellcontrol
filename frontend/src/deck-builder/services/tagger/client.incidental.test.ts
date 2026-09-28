// @vitest-environment node
//
// E476 against real tags: incidental ramp stops filling the ramp role at the
// one choke point every role count, badge, analysis and generator phase reads.
// Runs over the pinned tagger snapshot, never public/tagger-tags.json.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cardMatchesRole,
  getAllCardRoles,
  getCardRole,
  getRampSubtype,
  getRemovalSubtype,
  hasMultipleRoles,
  loadTaggerData,
  stampedRole,
  validateCardRole,
} from './client';

const here = dirname(fileURLToPath(import.meta.url));

beforeAll(async () => {
  const data = JSON.parse(
    readFileSync(
      resolve(here, '..', 'deckBuilder', '__fixtures__', 'tagger-tags.fixture.json'),
      'utf8'
    )
  );
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => data }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
});

afterAll(() => vi.unstubAllGlobals());

describe('incidental ramp is not ramp (E476, real tags)', () => {
  it('a counterspell or equipment that makes mana on the side has no ramp role', () => {
    // E486: a counterspell is removal, so Mana Drain lands there, never in ramp.
    expect(getCardRole('Mana Drain')).toBe('removal');
    expect(getAllCardRoles('Mana Drain')).toEqual(['removal']);
    expect(getCardRole('Sword of Feast and Famine')).toBeNull();
    expect(cardMatchesRole('Mana Drain', 'ramp')).toBe(false);
    expect(cardMatchesRole('Sword of Feast and Famine', 'ramp')).toBe(false);
    expect(getRampSubtype('Mana Drain')).toBeNull();
  });

  it('the oracle evidence gate inherits it (the generator and report path)', () => {
    // Mana Drain's own text passes the ramp evidence pattern ("add {C}"), so
    // only the tag-level rule keeps it out of the ramp count; it counts as the
    // removal its counter clause backs (E486).
    expect(
      validateCardRole({
        name: 'Mana Drain',
        oracle_text:
          "Counter target spell. At the beginning of your next main phase, add an amount of {C} equal to that spell's mana value.",
      })
    ).toBe('removal');
  });

  it('a removal card keeps removal and loses the secondary ramp role', () => {
    expect(getCardRole('Tinder Wall')).toBe('removal');
    expect(getAllCardRoles('Tinder Wall')).toEqual(['removal']);
    expect(hasMultipleRoles('Tinder Wall')).toBe(false);
  });

  it('keeps real ramp, including a land drop that bounces a land', () => {
    expect(getCardRole('Arcane Signet')).toBe('ramp');
    expect(getRampSubtype('Arcane Signet')).toBe('mana-rock');
    expect(getCardRole('Farseek')).toBe('ramp');
    expect(getCardRole('Mina and Denn, Wildborn')).toBe('ramp');
  });

  it('ignores a stale ramp stamp on a saved deck card, and trusts every other stamp', () => {
    expect(stampedRole({ name: 'Mana Drain', deckRole: 'ramp' })).toBeUndefined();
    expect(stampedRole({ name: 'Arcane Signet', deckRole: 'ramp' })).toBe('ramp');
    expect(stampedRole({ name: 'Tinder Wall', deckRole: 'removal' })).toBe('removal');
    expect(stampedRole({ name: 'Mana Drain' })).toBeUndefined();
  });
});

// Oracle text verbatim from Scryfall (2026-09-28), never paraphrased: the
// evidence patterns are regexes, so a hand-written line proves nothing.
const LILIANA_DREADHORDE =
  'Whenever a creature you control dies, draw a card.\n+1: Create a 2/2 black Zombie creature token.\n−4: Each player sacrifices two creatures of their choice.\n−9: Each opponent chooses a permanent they control of each permanent type and sacrifices the rest.';
const GOLGARI_CHARM =
  'Choose one —\n• All creatures get -1/-1 until end of turn.\n• Destroy target enchantment.\n• Regenerate each creature you control.';

describe('validateCardRole checks every tagged role, not only the first (E476, real tags)', () => {
  it('a planeswalker tagged boardwipe whose text is an edict counts as removal', () => {
    // Tagged boardwipe, removal and draw. Her text is not a wipe, so checking
    // only the first role counted her as nothing and Smart Trim read removal
    // as short (meren, gate wf_046f4b9f).
    expect(
      validateCardRole({ name: 'Liliana, Dreadhorde General', oracle_text: LILIANA_DREADHORDE })
    ).toBe('removal');
  });

  it('keeps the primary role when the text corroborates it', () => {
    expect(validateCardRole({ name: 'Golgari Charm', oracle_text: GOLGARI_CHARM })).toBe(
      'boardwipe'
    );
  });

  it('trusts the primary tag when there is no text to check', () => {
    expect(validateCardRole({ name: 'Liliana, Dreadhorde General' })).toBe('boardwipe');
  });

  it('still drops a role no tagged role corroborates', () => {
    expect(validateCardRole({ name: 'Golgari Charm', oracle_text: 'Flying.' })).toBeNull();
  });
});

// Verbatim Scryfall oracle text (2026-09-28).
const NEGATE = 'Counter target noncreature spell.';
const SWAN_SONG =
  'Counter target enchantment, instant, or sorcery spell. Its controller creates a 2/2 blue Bird creature token with flying.';
const DEADBRIDGE_CHANT =
  "When this enchantment enters, mill ten cards.\nAt the beginning of your upkeep, choose a card at random in your graveyard. If it's a creature card, put it onto the battlefield. Otherwise, put it into your hand.";

describe('counterspells are removal (E486, real tags + real text)', () => {
  it('a counterspell tagged only counterspell fills the removal role', () => {
    // 489 of 546 counterspells carried no removal tag and so had no role.
    expect(getCardRole('Counterspell')).toBe('removal');
    expect(cardMatchesRole('Negate', 'removal')).toBe(true);
    expect(getRemovalSubtype('Swan Song')).toBe('counterspell');
  });

  it('scoped counter text is removal evidence, not only "counter target spell"', () => {
    expect(validateCardRole({ name: 'Negate', oracle_text: NEGATE })).toBe('removal');
    expect(validateCardRole({ name: 'Swan Song', oracle_text: SWAN_SONG })).toBe('removal');
  });

  it('a self-bounce ramp card carries no removal subtype', () => {
    expect(getRemovalSubtype('Mina and Denn, Wildborn')).toBeNull();
  });
});

describe('graveyard-to-hand across sentences is card draw (E487, real tags + real text)', () => {
  it('Deadbridge Chant counts as draw', () => {
    expect(validateCardRole({ name: 'Deadbridge Chant', oracle_text: DEADBRIDGE_CHANT })).toBe(
      'cardDraw'
    );
  });
});
