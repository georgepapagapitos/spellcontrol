import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { ScryfallCache } from '../cache';
import { createMarkerGate, lookupCardsTool, makeCandidateResolver, runTool } from './tools';
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
  it('returns real cards with the text the model may quote', async () => {
    const tool = lookupCardsTool(cache, {});
    const { text, fetched } = await tool.run({ query: 'destroy target artifact' });
    expect(fetched.map((f) => f.name)).toContain('Naturalize');
    expect(text).toContain('Destroy target artifact');
    // The result carries type line and mana value, so the model never has to
    // supply those from memory.
    expect(text).toMatch(/Naturalize \(mana value 2\) — Instant:/);
  });

  it('confines results to the commander colour identity', async () => {
    const tool = lookupCardsTool(cache, { colorIdentity: ['B', 'G'] });
    const names = (await tool.run({ query: 'destroy target artifact' })).fetched.map((f) => f.name);
    expect(names).toContain('Naturalize');
    expect(names).not.toContain('Shatter'); // red — not castable in Golgari
  });

  it('excludes cards the deck already runs', async () => {
    const tool = lookupCardsTool(cache, { exclude: ['Naturalize'] });
    const names = (await tool.run({ query: 'destroy target artifact' })).fetched.map((f) => f.name);
    expect(names).not.toContain('Naturalize');
    expect(names).toContain('Relic Crush');
  });

  it('filters by type line', async () => {
    const tool = lookupCardsTool(cache, {});
    const names = (
      await tool.run({ query: 'destroy target artifact', type_line: 'Sorcery' })
    ).fetched.map((f) => f.name);
    expect(names).toEqual(['Relic Crush']);
  });

  it('tells the model to rephrase rather than returning nothing useful', async () => {
    const tool = lookupCardsTool(cache, {});
    const { text, fetched } = await tool.run({ query: 'zzzzz qqqqq wwwww' });
    expect(fetched).toEqual([]);
    expect(text).toMatch(/different rules wording/);
  });

  it('handles a missing query as a message, not a crash', async () => {
    const tool = lookupCardsTool(cache, {});
    const { text, fetched } = await tool.run({});
    expect(fetched).toEqual([]);
    expect(text).toMatch(/No query given/);
  });

  it('caps the result count even when the model asks for more', async () => {
    const tool = lookupCardsTool(cache, {});
    const { fetched } = await tool.run({ query: 'destroy target artifact', limit: 9999 });
    expect(fetched.length).toBeLessThanOrEqual(20);
  });
});

describe('runTool', () => {
  it('reports an unknown tool back to the model instead of throwing', async () => {
    const out = await runTool([], 'no_such_tool', {});
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/No tool named/);
  });

  it('turns a thrown tool into an error result so the review still finishes', async () => {
    const exploding = {
      definition: { name: 'boom', description: '', input_schema: { type: 'object' as const } },
      run: () => {
        throw new Error('kaboom');
      },
    };
    const out = await runTool([exploding], 'boom', {});
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
    gate.endTurn(true); // the turn ended in a tool call; that text is not the review
    gate.push(`${MARK}\nThe real answer.`);
    gate.endTurn(false);
    expect(gate.text).toBe(`${MARK}\nThe real answer.`);
    expect(gate.text).not.toMatch(/Searching/);
  });

  it('keeps a section that ended in a tool call — the review spans turns', () => {
    const gate = createMarkerGate(MARK);
    gate.push(`${MARK}\nFirst half.`);
    gate.endTurn(true);
    expect(gate.text).toBe(`${MARK}\nFirst half.`);
  });

  it('reports nothing when the model never emits a marker', () => {
    const gate = createMarkerGate(MARK, vi.fn());
    gate.push('A review with no labels at all.');
    expect(gate.opened).toBe(false);
    expect(gate.text).toBe('');
  });

  it('drops narration the model emits AFTER it has started answering', () => {
    // The production bug, in its exact shape: the model wrote the weakness,
    // went back to the tools, narrated between calls, then wrote the remaining
    // sections. The old gate opened once and kept everything after it, so five
    // interjections shipped inside the review and into `ai_reviews`.
    const seen: string[] = [];
    const gate = createMarkerGate(MARK, (t) => seen.push(t));

    gate.push(`${MARK}\nThe mana base cannot support the curve.`);
    gate.endTurn(true); // → looked a card up

    gate.push('Good—Mesmeric Orb directly mills whenever a permanent untaps.');
    gate.endTurn(true); // → searched again

    gate.push('That mills to the graveyard, not exile. Let me refine:');
    gate.endTurn(true); // → searched again

    gate.push('---GAMEPLAN---\nYour deck grinds value.');
    gate.endTurn(false); // → done

    expect(gate.text).toBe(
      `${MARK}\nThe mana base cannot support the curve.---GAMEPLAN---\nYour deck grinds value.`
    );
    expect(gate.text).not.toMatch(/Mesmeric Orb directly mills/);
    expect(gate.text).not.toMatch(/Let me refine/);
    // And it never reached the reader's screen either.
    expect(seen.join('')).not.toMatch(/Let me refine/);
  });

  it('keeps a markerless FINAL turn — nothing followed it, so it is the answer', () => {
    // The asymmetry the fix rests on: narration is always followed by a tool
    // call, so a markerless turn that ENDS the loop is the answer running on.
    const seen: string[] = [];
    const gate = createMarkerGate(MARK, (t) => seen.push(t));
    gate.push(`${MARK}\nThe weakness.`);
    gate.endTurn(true);
    gate.push(' And one more paragraph about it.');
    gate.endTurn(false);

    expect(gate.text).toBe(`${MARK}\nThe weakness. And one more paragraph about it.`);
    expect(seen.join('')).toContain('And one more paragraph');
  });

  it('still drops a markerless turn that DID lead to a tool call', () => {
    const gate = createMarkerGate(MARK);
    gate.push(`${MARK}\nThe weakness.`);
    gate.endTurn(true);
    gate.push('Let me check one more thing.');
    gate.endTurn(true);
    gate.push('---WINS---\nYou win by attacking.');
    gate.endTurn(false);
    expect(gate.text).not.toMatch(/one more thing/);
  });

  it('reads correctly mid-turn, for the iteration-cap path', () => {
    // `generateReview` returns the partial answer when it runs out of
    // iterations, and gets there without closing the turn.
    const gate = createMarkerGate(MARK);
    gate.push(`${MARK}\nA partial answer`);
    expect(gate.text).toBe(`${MARK}\nA partial answer`);
  });

  it('drops a DRAFT section the model later re-labels and rewrites', () => {
    // Reported from production after #1644. The per-turn rule does not cover a
    // turn that OPENS with the marker and then trails into narration on its way
    // to another tool call — it was kept whole:
    //
    //   ---WEAKNESS--- <draft> "Let me find those specific cards:"  → tool call
    //   ---WEAKNESS--- <rewrite> ---GAMEPLAN--- …                   → done
    //
    // The reader saw the draft, the narration, and then the real section, with a
    // literal ---WEAKNESS--- sitting in the prose.
    const gate = createMarkerGate(MARK);
    gate.push(`${MARK}\nThe draft weakness.\n\nLet me find those specific cards:`);
    gate.endTurn(true);
    gate.push(`${MARK}\nThe real weakness.\n---GAMEPLAN---\nThe plan.`);
    gate.endTurn(false);

    expect(gate.text).toBe(`${MARK}\nThe real weakness.\n---GAMEPLAN---\nThe plan.`);
    expect(gate.text).not.toMatch(/draft weakness/);
    expect(gate.text).not.toMatch(/Let me find those specific cards/);
    // Exactly one marker survives — the duplicate is what leaked into the prose.
    expect(gate.text.split(MARK).length - 1).toBe(1);
  });

  it('does NOT discard earlier sections when a LATER, different marker arrives', () => {
    // The restart rule keys on re-emitting the SAME marker. A turn that moves on
    // to the next section must not wipe the one before it.
    const gate = createMarkerGate(MARK);
    gate.push(`${MARK}\nThe weakness.`);
    gate.endTurn(true);
    gate.push('---GAMEPLAN---\nThe plan.');
    gate.endTurn(false);
    expect(gate.text).toBe(`${MARK}\nThe weakness.---GAMEPLAN---\nThe plan.`);
  });

  describe('the end marker', () => {
    const END = '---END---';

    it('drops narration the model writes after finishing, in the SAME turn', () => {
      // The production leak that survived #1644. Every rule above is per-TURN,
      // and this turn opened on the marker and never called a tool — so it was
      // kept whole and the notes rendered inside "How it wins".
      const seen: string[] = [];
      const gate = createMarkerGate(MARK, (t) => seen.push(t), END);

      gate.push(`${MARK}\nThe weakness.---WINS---\nCombat damage.\n\n${END}\n`);
      gate.push('Now for the prescriptions. I need to identify which untap creatures to cut:');
      gate.endTurn(false);

      // Trailing whitespace before the terminator is the caller's to trim
      // (`generateReview` does), so the gate cuts exactly at the marker.
      expect(gate.text.trim()).toBe(`${MARK}\nThe weakness.---WINS---\nCombat damage.`);
      expect(seen.join('')).not.toMatch(/Now for the prescriptions/);
      expect(seen.join('')).not.toContain(END);
    });

    it('never half-streams a terminator split across deltas', () => {
      // Without the hold-back the reader would see a dangling "---EN" that no
      // later delta completes, because the completing delta closes the gate.
      const seen: string[] = [];
      const gate = createMarkerGate(MARK, (t) => seen.push(t), END);
      gate.push(`${MARK}\nDone.\n---EN`);
      gate.push('D---\nAnd now some notes to myself.');
      gate.endTurn(false);

      expect(seen.join('')).toBe(`${MARK}\nDone.\n`);
      expect(gate.text).toBe(`${MARK}\nDone.\n`);
    });

    it('stays shut for the rest of the conversation', () => {
      const seen: string[] = [];
      const gate = createMarkerGate(MARK, (t) => seen.push(t), END);
      gate.push(`${MARK}\nThe answer.${END}`);
      gate.endTurn(true);
      gate.push(`${MARK}\nA whole second attempt at it.`);
      gate.endTurn(false);

      expect(gate.text).toBe(`${MARK}\nThe answer.`);
      expect(seen.join('')).not.toMatch(/second attempt/);
    });

    it('closes on a terminator in a markerless continuation turn', () => {
      const gate = createMarkerGate(MARK, undefined, END);
      gate.push(`${MARK}\nThe weakness.`);
      gate.endTurn(true);
      gate.push(` And the rest.\n${END}\nnotes`);
      gate.endTurn(false);
      expect(gate.text).toBe(`${MARK}\nThe weakness. And the rest.\n`);
    });

    it('is optional — no terminator behaves exactly as before', () => {
      const seen: string[] = [];
      const gate = createMarkerGate(MARK, (t) => seen.push(t));
      gate.push(`${MARK}\nThe weakness.`);
      gate.push(' Streamed as it arrives.');
      gate.endTurn(false);
      expect(seen).toEqual([`${MARK}\nThe weakness.`, ' Streamed as it arrives.']);
      expect(gate.text).toBe(`${MARK}\nThe weakness. Streamed as it arrives.`);
    });
  });
});

describe('lookup_cards, owned-only', () => {
  it('returns only cards the player owns', async () => {
    const tool = lookupCardsTool(cache, { ownedNames: ['Relic Crush'] });
    const names = (await tool.run({ query: 'destroy target artifact' })).fetched.map((f) => f.name);
    expect(names).toEqual(['Relic Crush']);
  });

  it('matches owned names case-insensitively — the two sides are entered separately', async () => {
    const tool = lookupCardsTool(cache, { ownedNames: ['relic crush'] });
    const names = (await tool.run({ query: 'destroy target artifact' })).fetched.map((f) => f.name);
    expect(names).toEqual(['Relic Crush']);
  });

  it('restricts INSIDE the query, so an owned card ranked low still surfaces', async () => {
    // The point of doing this in SQL: 'Relic Crush' loses on rank to the two
    // instants, so a post-filter with a small limit would answer "you own
    // nothing that does this" while the collection plainly holds an answer.
    const tool = lookupCardsTool(cache, { ownedNames: ['Relic Crush'] });
    const names = (await tool.run({ query: 'destroy target artifact', limit: 1 })).fetched.map(
      (f) => f.name
    );
    expect(names).toEqual(['Relic Crush']);
  });

  it('says the collection has no answer, not that the wording was wrong', async () => {
    const tool = lookupCardsTool(cache, { ownedNames: ['Some Card They Own'] });
    const { text, fetched } = await tool.run({ query: 'destroy target artifact' });
    expect(fetched).toEqual([]);
    expect(text).toMatch(/Nothing this player owns matched/);
  });

  it('tells the model in its own description that the results are owned', () => {
    expect(lookupCardsTool(cache, { ownedNames: [] }).definition.description).toMatch(
      /ALREADY OWNS/
    );
    expect(lookupCardsTool(cache, {}).definition.description).not.toMatch(/ALREADY OWNS/);
  });
});

describe('makeCandidateResolver', () => {
  /** getCheapestByName reads `card_lookups`, which the bulk ingest populates. */
  function alias(name: string, id: string, set = 'tst') {
    cache.setLookups([{ key: `ns:${name.toLowerCase()}|${set}`, scryfallId: id }]);
  }

  beforeEach(() => {
    alias('Naturalize', 'id-naturalize');
    alias('Shatter', 'id-shatter');
    alias('Relic Crush', 'id-crush');
  });

  it('accepts a real card and returns its canonical spelling', () => {
    const resolve = makeCandidateResolver(cache, {});
    expect(resolve('naturalize')).toBe('Naturalize');
  });

  it('rejects a card that does not exist — the hallucination case', () => {
    expect(makeCandidateResolver(cache, {})('Blightsteel Chancellor of Nothing')).toBeNull();
  });

  it('rejects a card outside the commander colour identity', () => {
    const resolve = makeCandidateResolver(cache, { colorIdentity: ['B', 'G'] });
    expect(resolve('Naturalize')).toBe('Naturalize');
    expect(resolve('Shatter')).toBeNull();
  });

  it('rejects a card the deck already runs', () => {
    const resolve = makeCandidateResolver(cache, { exclude: ['Naturalize'] });
    expect(resolve('Naturalize')).toBeNull();
  });

  it('rejects a card the player does not own when the build is owned-only', () => {
    const resolve = makeCandidateResolver(cache, { ownedNames: ['Relic Crush'] });
    expect(resolve('Relic Crush')).toBe('Relic Crush');
    expect(resolve('Naturalize')).toBeNull();
  });

  it('rejects a card that is not Commander-legal', () => {
    cache.setMany([
      card({
        id: 'id-banned',
        name: 'Banned Thing',
        oracle_id: 'o-banned',
        type_line: 'Artifact',
        oracle_text: 'Destroy target artifact.',
        color_identity: [],
        legalities: { commander: 'banned' },
      }),
    ]);
    alias('Banned Thing', 'id-banned');
    expect(makeCandidateResolver(cache, {})('Banned Thing')).toBeNull();
  });

  it('is recomputable from the request alone — the cache-replay guarantee', () => {
    // A stored refine reply is re-verified when it is replayed, long after the
    // cards the model fetched are gone. Two resolvers built from the same
    // request must therefore agree.
    const ctx = { colorIdentity: ['G'], exclude: ['Relic Crush'] };
    expect(makeCandidateResolver(cache, ctx)('Naturalize')).toBe(
      makeCandidateResolver(cache, ctx)('Naturalize')
    );
  });
});
