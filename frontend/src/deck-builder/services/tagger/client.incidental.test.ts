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
    expect(getCardRole('Mana Drain')).toBeNull();
    expect(getCardRole('Sword of Feast and Famine')).toBeNull();
    expect(cardMatchesRole('Mana Drain', 'ramp')).toBe(false);
    expect(cardMatchesRole('Sword of Feast and Famine', 'ramp')).toBe(false);
    expect(getRampSubtype('Mana Drain')).toBeNull();
  });

  it('the oracle evidence gate inherits it (the generator and report path)', () => {
    // Mana Drain's own text passes the ramp evidence pattern ("add {C}"), so
    // only the tag-level rule keeps it out of the ramp count.
    expect(
      validateCardRole({
        name: 'Mana Drain',
        oracle_text:
          "Counter target spell. At the beginning of your next main phase, add an amount of {C} equal to that spell's mana value.",
      })
    ).toBeNull();
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
