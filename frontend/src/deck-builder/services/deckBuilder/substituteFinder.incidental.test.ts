// @vitest-environment node
//
// E460 against real tags. The unit tests mock the tagger with a fixture
// taxonomy; this runs `isIncidentalRamp` and the Stand-ins gate over the
// pinned tagger snapshot (the one the substitute eval scores against), so the
// rule is checked against what Scryfall actually tags each card, not against
// tags written to make the test pass.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { findOwnedSubstitute, isIncidentalRamp } from './substituteFinder';

const here = dirname(fileURLToPath(import.meta.url));

beforeAll(async () => {
  const data = JSON.parse(
    readFileSync(resolve(here, '__fixtures__', 'tagger-tags.fixture.json'), 'utf8')
  );
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => data }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
});

afterAll(() => vi.unstubAllGlobals());

describe('incidental ramp (E460, real tags)', () => {
  it('flags cards whose job is something else and only make mana on the side', () => {
    // The two the upgrade plan surfaced as "fills the Ramp slot".
    expect(isIncidentalRamp('Mana Drain')).toBe(true);
    expect(isIncidentalRamp('Sword of Feast and Famine')).toBe(true);
    expect(isIncidentalRamp('Path to Exile')).toBe(true);
  });

  it('keeps real ramp', () => {
    expect(isIncidentalRamp('Arcane Signet')).toBe(false);
    expect(isIncidentalRamp('Farseek')).toBe(false);
    expect(isIncidentalRamp('Rampant Growth')).toBe(false);
  });

  it('never offers Mana Drain as the owned stand-in for a missing ramp staple', () => {
    const row = findOwnedSubstitute(
      {
        name: 'Farseek',
        role: 'ramp',
        roleLabel: 'Ramp',
        cmc: 2,
        typeLine: 'Sorcery',
        price: null,
        inclusion: 40,
        synergy: 0,
      },
      // Only incidental ramp owned: the honest answer is "buy it".
      [
        { name: 'Mana Drain', colorIdentity: ['U'], cmc: 2, typeLine: 'Instant' },
        {
          name: 'Sword of Feast and Famine',
          colorIdentity: [],
          cmc: 3,
          typeLine: 'Artifact — Equipment',
        },
      ],
      new Set(),
      ['G', 'U']
    );
    expect(row).toBeNull();
  });
});
