import { describe, it, expect, vi, afterEach } from 'vitest';
import { MAX_POOL, buildRefinePool, requestDeckRefine } from './ai-refine';
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import type { SubstituteRow } from '@/deck-builder/services/deckBuilder/substituteFinder';
import type { LandUpgradeMove } from '@/deck-builder/services/deckBuilder/landUpgrades';

afterEach(() => vi.unstubAllGlobals());

const gap = (name: string) => ({ name }) as GapAnalysisCard;
const syn = (cardName: string) => ({ cardName }) as SynergySuggestion;
const sub = (usedName: string) => ({ usedName }) as SubstituteRow;
// ⚠️ LandUpgradeMove.inName is the card ADDED (outName is the one cut) — the
// opposite polarity to Change.inName.
const land = (inName: string) => ({ inName, outName: 'Old Land' }) as LandUpgradeMove;

describe('buildRefinePool', () => {
  const empty = new Set<string>();

  it('unions the coach lanes, staples first and lands last', () => {
    const pool = buildRefinePool({
      gaps: [gap('Sol Ring')],
      synergy: [syn('Blood Artist')],
      substitutes: [sub('Viscera Seer')],
      landUpgrades: [land('Command Tower')],
      deckNames: empty,
    });
    expect(pool.map((c) => c.name)).toEqual([
      'Sol Ring',
      'Blood Artist',
      'Viscera Seer',
      'Command Tower',
    ]);
  });

  it('pools land upgrades — often the only lane with anything in it', () => {
    // Regression: the first cut omitted this, and every generated deck in the
    // dev account had gaps/synergy/substitutes empty while the coach showed
    // "Lands 6" — so the refine button sat permanently disabled.
    const pool = buildRefinePool({
      landUpgrades: [land('Command Tower'), land('Exotic Orchard')],
      deckNames: empty,
    });
    expect(pool.map((c) => c.name)).toEqual(['Command Tower', 'Exotic Orchard']);
  });

  it('takes the INCOMING land, never the one being cut', () => {
    const pool = buildRefinePool({ landUpgrades: [land('Command Tower')], deckNames: empty });
    expect(pool.map((c) => c.name)).toEqual(['Command Tower']);
    expect(pool.some((c) => c.name === 'Old Land')).toBe(false);
  });

  it('never offers a card the deck already runs', () => {
    const pool = buildRefinePool({
      gaps: [gap('Sol Ring'), gap('Command Tower')],
      deckNames: new Set(['Sol Ring']),
    });
    expect(pool.map((c) => c.name)).toEqual(['Command Tower']);
  });

  it('de-duplicates across lanes, case-insensitively', () => {
    const pool = buildRefinePool({
      gaps: [gap('Sol Ring')],
      synergy: [syn('sol ring')],
      substitutes: [sub('Sol Ring')],
      deckNames: empty,
    });
    expect(pool).toHaveLength(1);
  });

  it('keeps an owned-only build inside the collection', () => {
    // Suggesting a card the player would have to buy defeats the setting they
    // generated under.
    const pool = buildRefinePool({
      gaps: [gap('Mana Crypt'), gap('Arcane Signet')],
      deckNames: empty,
      ownedNames: new Set(['Arcane Signet']),
    });
    expect(pool.map((c) => c.name)).toEqual(['Arcane Signet']);
  });

  it('ignores ownership entirely when the build was not owned-only', () => {
    const pool = buildRefinePool({ gaps: [gap('Mana Crypt')], deckNames: empty });
    expect(pool.map((c) => c.name)).toEqual(['Mana Crypt']);
  });

  it(`caps at ${MAX_POOL}, trimming the speculative end not the staples`, () => {
    const pool = buildRefinePool({
      gaps: Array.from({ length: MAX_POOL }, (_, i) => gap(`Staple ${i}`)),
      substitutes: [sub('Trimmed Substitute')],
      deckNames: empty,
    });
    expect(pool).toHaveLength(MAX_POOL);
    expect(pool.some((c) => c.name === 'Trimmed Substitute')).toBe(false);
  });
});

describe('requestDeckRefine', () => {
  const payload = {
    deckId: 'd1',
    commander: 'Meren',
    cards: [{ name: 'Swamp', oracleId: 'o', qty: 1 }],
    pool: [{ name: 'Sol Ring', oracleId: 'o', qty: 1 }],
    ownedOnly: false,
    analysis: {} as never,
  };

  const DONE = {
    content: 'Your deck grinds.',
    tweaks: [{ add: 'Sol Ring', cut: 'Swamp', why: 'Ramp beats a land here.' }],
    cached: false,
    model: 'm',
    usage: { inputTokens: 1, outputTokens: 2 },
  };

  function stub(lines: unknown[], status = 200) {
    const body = lines.map((l) => `${JSON.stringify(l)}\n`).join('');
    const mock = vi.fn().mockResolvedValue(new Response(body, { status }));
    vi.stubGlobal('fetch', mock);
    return mock;
  }

  it('streams the prose and returns the verified tweaks', async () => {
    const mock = stub([{ delta: 'Your deck ' }, { delta: 'grinds.' }, { done: DONE }]);
    const seen: string[] = [];
    const result = await requestDeckRefine(payload, (t) => seen.push(t));
    expect(seen).toEqual(['Your deck ', 'Your deck grinds.']);
    expect(result).toEqual(DONE);
    expect((mock.mock.calls[0] as [string])[0]).toBe('/api/ai/deck-refine');
  });

  it('accepts an empty tweak list as a real answer', async () => {
    stub([{ delta: 'Nothing to change.' }, { done: { ...DONE, tweaks: [] } }]);
    await expect(requestDeckRefine(payload)).resolves.toMatchObject({ tweaks: [] });
  });

  it('treats a stream with no terminator as a failure', async () => {
    stub([{ delta: 'half' }]);
    await expect(requestDeckRefine(payload)).rejects.toThrow(/ended early/);
  });

  it('throws the in-band error from a mid-stream failure', async () => {
    stub([{ delta: 'x' }, { error: 'The refine pass could not be generated.' }]);
    await expect(requestDeckRefine(payload)).rejects.toThrow('could not be generated');
  });

  it('surfaces a pre-stream error with its status', async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'Daily limit reached' }), { status: 429 })
      );
    vi.stubGlobal('fetch', mock);
    await expect(requestDeckRefine(payload)).rejects.toMatchObject({ status: 429 });
  });
});
