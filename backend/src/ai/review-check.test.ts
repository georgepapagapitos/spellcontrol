import { describe, it, expect } from 'vitest';
import type { AiGeneration } from './client';
import { buildFacts, type DeckFacts } from './facts-sheet';
import type { OracleEntry } from './deck-review';
import { checkWeakness, correctionNote, weaknessOf, writeCheckedReview } from './review-check';

// Oracle lines copied verbatim from the eval fixtures' Card reference blocks
// (Scryfall oracle data, never author-written).
const o = (
  name: string,
  manaCost: string | undefined,
  typeLine: string,
  oracleText: string
): OracleEntry => ({ name, manaCost, typeLine, oracleText });

const oracle: OracleEntry[] = [
  o(
    'Fiery Confluence',
    '{2}{R}{R}',
    'Sorcery',
    'Choose three. You may choose the same mode more than once. • Fiery Confluence deals 1 damage to each creature. • Fiery Confluence deals 2 damage to each opponent. • Destroy target artifact.'
  ),
  o(
    'Swords to Plowshares',
    '{W}',
    'Instant',
    'Exile target creature. Its controller gains life equal to its power.'
  ),
  o('Vindicate', '{1}{W}{B}', 'Sorcery', 'Destroy target permanent.'),
  o('Despark', '{W}{B}', 'Instant', 'Exile target permanent with mana value 4 or greater.'),
  o('Wrath of God', '{2}{W}{W}', 'Sorcery', "Destroy all creatures. They can't be regenerated."),
  o(
    'Lightning Greaves',
    '{2}',
    'Artifact — Equipment',
    "Equipped creature has haste and shroud. (It can't be the target of spells or abilities.) Equip {0}"
  ),
  o(
    'Krenko, Mob Boss',
    '{2}{R}{R}',
    'Legendary Creature — Goblin Warrior',
    '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.'
  ),
  o(
    'Baleful Strix',
    '{U}{B}',
    'Artifact Creature — Bird',
    'Flying, deathtouch When this creature enters, draw a card.'
  ),
];

const noTags = () => false;
const names = oracle.map((e) => ({ name: e.name, qty: 1 }));

function factsFor(cards = names, commanders = ['Krenko, Mob Boss']): DeckFacts {
  return buildFacts({ commanders, cards, oracle, taggerHas: noTags }).facts;
}

describe('buildFacts', () => {
  it('carries structured lists for the check', () => {
    const f = factsFor();
    expect(f.roles.sweeper).toEqual(['Fiery Confluence', 'Wrath of God']);
    expect(f.cheapRemoval).toContain('Swords to Plowshares');
    expect(f.cheapRemoval).not.toContain('Vindicate');
    expect(f.instantRemoval).toEqual(expect.arrayContaining(['Swords to Plowshares', 'Despark']));
    expect(f.creatureCount).toBe(1);
  });
});

describe('checkWeakness', () => {
  const f = factsFor();
  const hit = (s: string) => checkWeakness(s, f).map((c) => c.sentence);

  it('catches "no sweeper" beside Fiery Confluence', () => {
    const found = checkWeakness('Your deck has no sweeper to reset a board it falls behind on.', f);
    expect(found).toHaveLength(1);
    expect(found[0].fact).toContain('Fiery Confluence');
  });

  it('catches the Krenko-is-missing claim for a card the deck runs', () => {
    expect(
      hit('Krenko, Mob Boss is not in the list, so the goblin plan has no engine.')
    ).toHaveLength(1);
    expect(hit('Krenko is missing from the deck entirely.')).toHaveLength(1);
  });

  it('catches "lacks cheap interaction" beside Swords to Plowshares and Despark', () => {
    const found = checkWeakness('The deck lacks cheap interaction to stop a fast start.', f);
    expect(found[0].fact).toContain('Swords to Plowshares');
    expect(hit('You have no instant-speed removal at all.')).toHaveLength(1);
  });

  it('catches answers claimed absent for a target type the deck answers', () => {
    expect(hit("You can't answer an enchantment once it lands.")).toHaveLength(1);
    expect(hit('Nothing in the list deals with artifacts.')).toHaveLength(1);
  });

  it('does not flag a claim the sheet agrees with', () => {
    const bare = factsFor([{ name: 'Krenko, Mob Boss', qty: 1 }]);
    expect(checkWeakness('Your deck has no sweeper and no counterspell.', bare)).toEqual([]);
    expect(checkWeakness('Your deck has no answer to a planeswalker.', bare)).toEqual([]);
  });

  it('does not flag a qualified removal claim or an opinion', () => {
    expect(hit('You have no removal that answers a resolved Wrath of God effect.')).toEqual([]);
    expect(hit('Fiery Confluence is your only sweeper, so one answer is thin.')).toEqual([]);
  });

  it('leaves "few creatures" alone in a creature-light deck and flags it in a creature-heavy one', () => {
    expect(hit('The deck runs very few creatures.')).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `Bear ${i}`, qty: 1 }));
    const heavy = buildFacts({
      commanders: ['Krenko, Mob Boss'],
      cards: many,
      oracle: [...oracle, ...many.map((c) => o(c.name, '{1}{G}', 'Creature — Bear', ''))],
      taggerHas: noTags,
    }).facts;
    expect(checkWeakness('The deck runs very few creatures.', heavy)).toHaveLength(1);
  });

  it('does not flag qualified or hedged claims the count cannot refute (from real model output)', () => {
    const f = factsFor();
    const hit = (t: string) => checkWeakness(t, f).length;
    expect(hit('Your deck has no answer to artifacts at instant speed except Despark.')).toBe(0);
    expect(hit('Your engine has no clock to convert card advantage into damage.')).toBe(0);
    expect(hit('It has almost no way to stop an opposing artifact engine.')).toBe(0);
    expect(hit('It cannot reliably answer a resolved artifact threat.')).toBe(0);
    expect(hit('Your deck has no effective answer to an opposing enchantment.')).toBe(1);
  });

  it('reads the tagger set too, like the sheet', () => {
    const f2 = buildFacts({
      commanders: [],
      cards: [{ name: 'Mystery Wipe', qty: 1 }],
      oracle: [],
      taggerHas: (n, t) => n === 'Mystery Wipe' && t === 'boardwipe',
    }).facts;
    expect(checkWeakness('There is no board wipe here.', f2)).toHaveLength(1);
  });
});

describe('weaknessOf / correctionNote', () => {
  it('cuts the section out of a partial review', () => {
    const text = '---WEAKNESS---\nOne. Two.\n\n---FIXES---\nDo it.';
    expect(weaknessOf(text)).toBe('One. Two.');
    expect(weaknessOf('---WEAKNESS---\nStill writing')).toBe('Still writing');
  });

  it('quotes the claim and the count, and says not to mention itself', () => {
    const note = correctionNote([
      { sentence: 'No sweeper.', fact: 'Sweepers (1): Fiery Confluence' },
    ]);
    expect(note).toContain('You wrote: "No sweeper."');
    expect(note).toContain('Sweepers (1): Fiery Confluence');
    expect(note).toContain('Do not mention this note');
  });
});

describe('writeCheckedReview', () => {
  const gen = (content: string): AiGeneration =>
    ({
      content,
      fetched: [],
      inputTokens: 1,
      outputTokens: 1,
      truncated: false,
    }) as unknown as AiGeneration;

  // A writer that streams the draft in small chunks like the model does.
  const writer = (drafts: string[]) => {
    const seen: string[] = [];
    let i = 0;
    return {
      seen,
      write: async (user: string, onDelta: (t: string) => void, signal: AbortSignal) => {
        seen.push(user);
        const draft = drafts[i++];
        for (let at = 0; at < draft.length; at += 12) {
          if (signal.aborted) throw new Error('aborted');
          onDelta(draft.slice(at, at + 12));
        }
        return gen(draft);
      },
    };
  };
  const bad =
    '---WEAKNESS---\nYour deck has no sweeper at all.\n\n---FIXES---\nAdd a wrath.\n---END---';
  const good =
    '---WEAKNESS---\nFiery Confluence is your only sweeper, so one answer is thin.\n\n---FIXES---\nAdd a wrath.\n---END---';

  it('streams a clean draft straight through, one call', async () => {
    const w = writer([good]);
    const sent: string[] = [];
    const { report } = await writeCheckedReview({
      write: w.write,
      user: 'U',
      facts: factsFor(),
      send: (t) => sent.push(t),
    });
    expect(sent.join('')).toBe(good);
    expect(w.seen).toEqual(['U']);
    expect(report.regenerated).toBe(false);
  });

  it('discards a contradicted draft before the reader sees it and regenerates once with a note', async () => {
    const w = writer([bad, good]);
    const sent: string[] = [];
    const { generation, report } = await writeCheckedReview({
      write: w.write,
      user: 'U',
      facts: factsFor(),
      send: (t) => sent.push(t),
    });
    expect(sent.join('')).toBe(good);
    expect(sent.join('')).not.toContain('no sweeper');
    expect(w.seen).toHaveLength(2);
    expect(w.seen[1]).toContain('## Correction');
    expect(w.seen[1]).toContain('Fiery Confluence');
    expect(generation.content).toBe(good);
    expect(report.caught).toHaveLength(1);
    expect(report.regenerated).toBe(true);
  });

  it('cuts the contradicted sentence from a second bad draft', async () => {
    const twoSentences =
      '---WEAKNESS---\nYour deck has no sweeper at all. The curve tops out high.\n\n---FIXES---\nAdd a wrath.\n---END---';
    const w = writer([bad, twoSentences]);
    const sent: string[] = [];
    const { generation, report } = await writeCheckedReview({
      write: w.write,
      user: 'U',
      facts: factsFor(),
      send: (t) => sent.push(t),
    });
    expect(sent.join('')).not.toContain('no sweeper');
    expect(sent.join('')).toContain('The curve tops out high.');
    expect(generation.content).toBe(sent.join(''));
    expect(report.stripped).toHaveLength(1);
  });

  it('ships the second draft as written when cutting would empty the section, and counts it', async () => {
    const w = writer([bad, bad]);
    const sent: string[] = [];
    const { report } = await writeCheckedReview({
      write: w.write,
      user: 'U',
      facts: factsFor(),
      send: (t) => sent.push(t),
    });
    expect(sent.join('')).toBe(bad);
    expect(report.shippedContradicted).toBe(true);
  });

  it('replays the held chunks one by one, so the client sees the same deltas', async () => {
    const chunks = ['---WEAKNESS---\nFiery ', 'Confluence is thin.\n\n---FIXES---\n', 'Add one.'];
    const sent: string[] = [];
    await writeCheckedReview({
      write: async (_u, onDelta) => {
        chunks.forEach(onDelta);
        return gen(chunks.join(''));
      },
      user: 'U',
      facts: factsFor(),
      send: (t) => sent.push(t),
    });
    expect(sent).toEqual(chunks);
  });

  it('shows what was streamed before a mid-stream failure, then rethrows', async () => {
    const sent: string[] = [];
    await expect(
      writeCheckedReview({
        write: async (_u, onDelta) => {
          onDelta('---WEAKNESS---\nStill writing');
          throw new Error('boom');
        },
        user: 'U',
        facts: factsFor(),
        send: (t) => sent.push(t),
      })
    ).rejects.toThrow('boom');
    expect(sent.join('')).toBe('---WEAKNESS---\nStill writing');
  });

  it('does nothing without facts', async () => {
    const w = writer([bad]);
    const sent: string[] = [];
    const { report } = await writeCheckedReview({
      write: w.write,
      user: 'U',
      facts: null,
      send: (t) => sent.push(t),
    });
    expect(sent.join('')).toBe(bad);
    expect(report.regenerated).toBe(false);
  });
});
