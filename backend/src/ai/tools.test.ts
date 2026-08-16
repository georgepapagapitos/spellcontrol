import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { ScryfallCache } from '../cache';
import { createMarkerGate, lookupCardsTool, runTool } from './tools';
import type { ScryfallCard } from '../types';

function card(overrides: Partial<ScryfallCard> & { id: string; name: string }): ScryfallCard {
  return {
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    collector_number: '1',
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

let dir: string;
let cache: ScryfallCache;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-tools-test-'));
  cache = new ScryfallCache(path.join(dir, 'cards.db'));
  cache.setMany([
    card({
      id: 'id-naturalize',
      name: 'Naturalize',
      oracle_id: 'o-nat',
      type_line: 'Instant',
      oracle_text: 'Destroy target artifact or enchantment.',
      color_identity: ['G'],
      cmc: 2,
    }),
    card({
      id: 'id-shatter',
      name: 'Shatter',
      oracle_id: 'o-shatter',
      type_line: 'Instant',
      oracle_text: 'Destroy target artifact.',
      color_identity: ['R'],
      cmc: 2,
    }),
    card({
      id: 'id-crush',
      name: 'Relic Crush',
      oracle_id: 'o-crush',
      type_line: 'Sorcery',
      oracle_text: 'Destroy target artifact or enchantment.',
      color_identity: ['G'],
      cmc: 4,
    }),
  ]);
});

afterEach(() => {
  cache.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('lookup_cards', () => {
  it('returns real cards with the text the model may quote', () => {
    const tool = lookupCardsTool(cache, {});
    const { text, fetched } = tool.run({ query: 'destroy target artifact' });
    expect(fetched.map((f) => f.name)).toContain('Naturalize');
    expect(text).toContain('Destroy target artifact');
    // The result carries type line and mana value, so the model never has to
    // supply those from memory.
    expect(text).toMatch(/Naturalize \(mana value 2\) — Instant:/);
  });

  it('confines results to the commander colour identity', () => {
    const tool = lookupCardsTool(cache, { colorIdentity: ['B', 'G'] });
    const names = tool.run({ query: 'destroy target artifact' }).fetched.map((f) => f.name);
    expect(names).toContain('Naturalize');
    expect(names).not.toContain('Shatter'); // red — not castable in Golgari
  });

  it('excludes cards the deck already runs', () => {
    const tool = lookupCardsTool(cache, { exclude: ['Naturalize'] });
    const names = tool.run({ query: 'destroy target artifact' }).fetched.map((f) => f.name);
    expect(names).not.toContain('Naturalize');
    expect(names).toContain('Relic Crush');
  });

  it('filters by type line', () => {
    const tool = lookupCardsTool(cache, {});
    const names = tool
      .run({ query: 'destroy target artifact', type_line: 'Sorcery' })
      .fetched.map((f) => f.name);
    expect(names).toEqual(['Relic Crush']);
  });

  it('tells the model to rephrase rather than returning nothing useful', () => {
    const tool = lookupCardsTool(cache, {});
    const { text, fetched } = tool.run({ query: 'zzzzz qqqqq wwwww' });
    expect(fetched).toEqual([]);
    expect(text).toMatch(/different rules wording/);
  });

  it('handles a missing query as a message, not a crash', () => {
    const tool = lookupCardsTool(cache, {});
    const { text, fetched } = tool.run({});
    expect(fetched).toEqual([]);
    expect(text).toMatch(/No query given/);
  });

  it('caps the result count even when the model asks for more', () => {
    const tool = lookupCardsTool(cache, {});
    const { fetched } = tool.run({ query: 'destroy target artifact', limit: 9999 });
    expect(fetched.length).toBeLessThanOrEqual(20);
  });
});

describe('runTool', () => {
  it('reports an unknown tool back to the model instead of throwing', () => {
    const out = runTool([], 'no_such_tool', {});
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/No tool named/);
  });

  it('turns a thrown tool into an error result so the review still finishes', () => {
    const exploding = {
      definition: { name: 'boom', description: '', input_schema: { type: 'object' as const } },
      run: () => {
        throw new Error('kaboom');
      },
    };
    const out = runTool([exploding], 'boom', {});
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/Continue without it/);
    expect(out.fetched).toEqual([]);
  });
});

describe('createMarkerGate', () => {
  const MARK = '---WEAKNESS---';

  it('withholds the model thinking out loud before the review starts', () => {
    const seen: string[] = [];
    const gate = createMarkerGate(MARK, (t) => seen.push(t));
    gate.push("I'll look up some artifact removal first.");
    expect(seen).toEqual([]);
    expect(gate.text).toBe('');
    expect(gate.opened).toBe(false);
  });

  it('starts emitting at the marker and streams live after it', () => {
    const seen: string[] = [];
    const gate = createMarkerGate(MARK, (t) => seen.push(t));
    gate.push('Let me search. ');
    gate.push(`${MARK}\nYour deck`);
    gate.push(' cannot cast its spells.');

    expect(gate.opened).toBe(true);
    // Narration is gone; the first emit begins exactly at the marker.
    expect(seen[0]).toBe(`${MARK}\nYour deck`);
    // Everything after streams through as it arrives, not in one lump.
    expect(seen[1]).toBe(' cannot cast its spells.');
    expect(gate.text).toBe(`${MARK}\nYour deck cannot cast its spells.`);
  });

  it('finds the marker even when it is split across deltas', () => {
    const gate = createMarkerGate(MARK);
    gate.push('chatter ---WEAK');
    gate.push('NESS---\nThe weakness.');
    expect(gate.opened).toBe(true);
    expect(gate.text).toBe(`${MARK}\nThe weakness.`);
  });

  it('drops a discarded tool turn so it cannot leak into the answer', () => {
    const gate = createMarkerGate(MARK);
    gate.push('Searching for removal...');
    gate.reset(); // the turn ended in a tool call; that text is not the review
    gate.push(`${MARK}\nThe real answer.`);
    expect(gate.text).toBe(`${MARK}\nThe real answer.`);
    expect(gate.text).not.toMatch(/Searching/);
  });

  it('reset after the marker keeps the answer — the review spans turns', () => {
    const gate = createMarkerGate(MARK);
    gate.push(`${MARK}\nFirst half.`);
    gate.reset();
    expect(gate.text).toBe(`${MARK}\nFirst half.`);
  });

  it('reports nothing when the model never emits a marker', () => {
    const gate = createMarkerGate(MARK, vi.fn());
    gate.push('A review with no labels at all.');
    expect(gate.opened).toBe(false);
    expect(gate.text).toBe('');
  });
});
