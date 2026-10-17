import { describe, it, expect } from 'vitest';
import {
  HITS_OWNER_TOO,
  PROSE_CHECK_SYSTEM_PROMPT,
  applyProseCheck,
  buildProseCheckMessage,
  checkSentence,
  makeCheckedProse,
  saysWho,
  splitSentences,
  type SentenceCheck,
} from './prose-check';

// Real oracle text (Scryfall, 2026-10-17). The paragraph is the owner's live
// Zo-Zu reading after #2996: its swaps were right, its strategy was not.
const ZOZU = {
  name: 'Zo-Zu the Punisher',
  manaCost: '{1}{R}{R}',
  typeLine: 'Legendary Creature — Goblin Warrior',
  oracleText: "Whenever a land enters, Zo-Zu deals 2 damage to that land's controller.",
};
const ANKH = {
  name: 'Ankh of Mishra',
  manaCost: '{2}',
  typeLine: 'Artifact',
  oracleText: "Whenever a land enters, this artifact deals 2 damage to that land's controller.",
};
const DESCENT = {
  name: 'Descent into Avernus',
  manaCost: '{2}{R}',
  typeLine: 'Enchantment',
  oracleText:
    'At the beginning of your upkeep, put two descent counters on this enchantment. Then each player creates X Treasure tokens and this enchantment deals X damage to each player, where X is the number of descent counters on this enchantment.',
};
const VORTEX = {
  name: 'Roiling Vortex',
  manaCost: '{1}{R}',
  typeLine: 'Enchantment',
  oracleText:
    "At the beginning of each player's upkeep, this enchantment deals 1 damage to them.\nWhenever a player casts a spell, if no mana was spent to cast that spell, this enchantment deals 5 damage to that player.\n{R}: Your opponents can't gain life this turn.",
};
const BUZZCRUSHER = {
  name: "Krenko's Buzzcrusher",
  manaCost: '{2}{R}{R}',
  typeLine: 'Artifact Creature — Insect Thopter',
  oracleText:
    'Flying, trample\nWhen this creature enters, for each player, destroy up to one nonbasic land that player controls. For each land destroyed this way, its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.',
};
const ORACLE = [ZOZU, ANKH, DESCENT, VORTEX, BUZZCRUSHER];

const LAND_DROPS =
  "Lands and Zo-Zu's trigger together turn each land drop into a source of damage.";
const DESCENT_LINE = 'Descent into Avernus and Roiling Vortex keep the damage coming.';
const ANKH_LINE = 'Ankh of Mishra doubles that, so every land an opponent plays costs them 4 life.';
const PARAGRAPH = `Your deck is a punisher shell built around Zo-Zu the Punisher. ${LAND_DROPS} ${ANKH_LINE} ${DESCENT_LINE}`;

const input = {
  commanders: ['Zo-Zu the Punisher'],
  decklist: [
    { name: 'Ankh of Mishra', qty: 1 },
    { name: 'Descent into Avernus', qty: 1 },
    { name: 'Roiling Vortex', qty: 1 },
    { name: "Krenko's Buzzcrusher", qty: 1 },
    { name: 'Mountain', qty: 27 },
  ],
  oracle: ORACLE,
  analysis: { lands: 32 },
};

const usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };

/** A checker reply for one sentence. */
const reply = (...claims: { holds: boolean; hits_owner?: boolean }[]) =>
  JSON.stringify([
    { n: 1, claims: claims.map((c, j) => ({ claim: `c${j + 1}`, text: 'x', reading: 'y', ...c })) },
  ]);

describe('splitSentences', () => {
  it('splits a paragraph into its sentences', () => {
    const s = splitSentences(PARAGRAPH);
    expect(s).toHaveLength(4);
    expect(s[1]).toBe(LAND_DROPS);
    expect(s.join(' ')).toBe(PARAGRAPH);
  });

  it('does not end a sentence at a full stop inside a card name', () => {
    const p = 'Mr. House, President and CEO rolls dice. It makes tokens.';
    expect(splitSentences(p, ['Mr. House, President and CEO'])).toEqual([
      'Mr. House, President and CEO rolls dice.',
      'It makes tokens.',
    ]);
  });
});

describe('saysWho', () => {
  it('reads whether the sentence itself says who takes the damage', () => {
    expect(saysWho('Roiling Vortex hits every player each upkeep, you included.')).toBe(true);
    expect(saysWho('Descent into Avernus deals damage to each player.')).toBe(true);
    expect(saysWho('Zo-Zu pings whichever player plays a land.')).toBe(true);
    expect(saysWho(ANKH_LINE)).toBe(true);
    expect(saysWho(DESCENT_LINE)).toBe(false);
    expect(saysWho(LAND_DROPS)).toBe(false);
  });
});

describe('buildProseCheckMessage', () => {
  const [first, second] = splitSentences(PARAGRAPH);
  const message = buildProseCheckMessage(input, first, second);

  it('sends the sentence, the text before it, and the text of every card either names', () => {
    expect(message).toContain(`## Sentence to check\n\n${LAND_DROPS}`);
    expect(message).toContain(`## Text before it (context only)\n\n${first}`);
    expect(message).toContain("Zo-Zu deals 2 damage to that land's controller");
    // Named nowhere in either.
    expect(message).not.toContain('descent counters');
  });

  it('marks the first sentence as having no context', () => {
    expect(buildProseCheckMessage(input, '', first)).toContain(
      '(none: this is the first sentence)'
    );
  });

  it('lists the deck by type line', () => {
    expect(message).toContain('1 Descent into Avernus — Enchantment');
    expect(message).toContain('## Decklist (31)');
  });

  it('shares the claim rules with the swap check and asks for the direction field', () => {
    expect(PROSE_CHECK_SYSTEM_PROMPT).toContain('WHO each effect touches');
    expect(PROSE_CHECK_SYSTEM_PROMPT).toContain('"hits_owner"');
  });
});

describe('applyProseCheck', () => {
  it('fails damage the owner takes too, in a sentence that never says so, even when the checker said it holds', () => {
    // What Haiku 5.5 wrote on the owner's sentence: holds, owner hit.
    expect(applyProseCheck(reply({ holds: true, hits_owner: true }), LAND_DROPS)).toEqual([
      `${HITS_OWNER_TOO}c1`,
    ]);
    expect(applyProseCheck(reply({ holds: true, hits_owner: true }), DESCENT_LINE)).toHaveLength(1);
  });

  it('holds it when the sentence says who takes it', () => {
    const vortex = 'Roiling Vortex deals 1 damage to every player each upkeep, you included.';
    expect(applyProseCheck(reply({ holds: true, hits_owner: true }), vortex)).toEqual([]);
    expect(applyProseCheck(reply({ holds: true, hits_owner: true }), ANKH_LINE)).toEqual([]);
  });

  it('lists a claim that failed outright once', () => {
    expect(
      applyProseCheck(reply({ holds: true }, { holds: false, hits_owner: true }), LAND_DROPS)
    ).toEqual(['c2']);
  });

  it('returns null for a reply that is not a claim list', () => {
    expect(applyProseCheck('not json', LAND_DROPS)).toBeNull();
    expect(applyProseCheck('[{"n": 2, "claims": []}]', LAND_DROPS)).toBeNull();
  });
});

describe('checkSentence', () => {
  it('keeps the sentence as written when the check errors or does not parse', async () => {
    const threw = await checkSentence(input, '', LAND_DROPS, () =>
      Promise.reject(new Error('529'))
    );
    expect(threw).toMatchObject({ sentence: LAND_DROPS, failed: [], unchecked: true });
    const garbled = await checkSentence(input, '', LAND_DROPS, async () => ({
      content: '[{"n":1',
    }));
    expect(garbled.unchecked).toBe(true);
  });

  it('rethrows once the request is aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      checkSentence(input, '', LAND_DROPS, () => Promise.reject(new Error('aborted')), ac.signal)
    ).rejects.toThrow('aborted');
  });

  it('returns its verdict and usage', async () => {
    const out = await checkSentence(input, '', LAND_DROPS, async () => ({
      content: reply({ holds: true, hits_owner: true }),
      inputTokens: 900,
      outputTokens: 40,
    }));
    expect(out).toMatchObject({ failed: [`${HITS_OWNER_TOO}c1`], unchecked: false });
    expect(out.usage).toEqual({ ...usage, inputTokens: 900, outputTokens: 40 });
  });
});

describe('makeCheckedProse', () => {
  const verdict = (sentence: string, failed: string[] = []): SentenceCheck => ({
    sentence,
    failed,
    unchecked: false,
    usage: { ...usage, inputTokens: 10 },
  });

  it('checks each sentence once it is complete and emits them in order, only once checked', async () => {
    const resolvers: ((v: SentenceCheck) => void)[] = [];
    const seen: [string, string][] = [];
    const emitted: string[] = [];
    const prose = makeCheckedProse(
      (context, sentence) => {
        seen.push([context, sentence]);
        return new Promise((r) => resolvers.push(r));
      },
      (t) => emitted.push(t)
    );
    const first = 'Zo-Zu the Punisher leads a deck that hurts every player.';
    prose.push(`${first} Second sentence of the first paragraph, still being writ`);
    // The first sentence counts as complete once enough text follows it.
    expect(seen).toEqual([['', first]]);
    prose.push('ten.\n\nA new paragraph.');
    expect(seen.map(([, s]) => s)).toEqual([
      first,
      'Second sentence of the first paragraph, still being written.',
    ]);
    expect(seen[1][0]).toBe(first);
    // The tail the gate held back is in the parsed strategy, not the stream.
    const done = prose.finish(
      `${first} Second sentence of the first paragraph, still being written.\n\nA new paragraph.`
    );
    expect(seen[2]).toEqual([
      `${first} Second sentence of the first paragraph, still being written.`,
      'A new paragraph.',
    ]);
    resolvers[2](verdict('A new paragraph.'));
    resolvers[1](verdict('Second sentence of the first paragraph, still being written.'));
    await Promise.resolve();
    expect(emitted).toEqual([]);
    resolvers[0](verdict(first));
    const out = await done;
    expect(emitted).toEqual([
      first,
      ' Second sentence of the first paragraph, still being written.',
      '\n\nA new paragraph.',
    ]);
    expect(out.strategy).toBe(
      `${first} Second sentence of the first paragraph, still being written.\n\nA new paragraph.`
    );
    expect(out.usage.inputTokens).toBe(30);
  });

  it('waits out a full stop inside a card name before calling the sentence complete', () => {
    const seen: string[] = [];
    const prose = makeCheckedProse(
      async (_c, s) => {
        seen.push(s);
        return verdict(s);
      },
      () => {},
      ['Mr. House, President and CEO']
    );
    prose.push('Your deck runs Mr. Hou');
    prose.push('se, President and CEO');
    expect(seen).toEqual([]);
  });

  it('never emits a dropped sentence, and a paragraph with nothing left leaves no gap', async () => {
    const emitted: string[] = [];
    const prose = makeCheckedProse(
      async (_c, s) => verdict(s, s === LAND_DROPS ? ['direction'] : []),
      (t) => emitted.push(t)
    );
    const out = await prose.finish(`${LAND_DROPS}\n\n${ANKH_LINE}`);
    expect(emitted.join('')).toBe(ANKH_LINE);
    expect(out.strategy).toBe(ANKH_LINE);
    expect(out.grounding).toEqual({ dropped: [{ sentence: LAND_DROPS, failed: ['direction'] }] });
  });

  it('counts the sentences that shipped unchecked', async () => {
    const prose = makeCheckedProse(
      async (_c, s) => ({ ...verdict(s), unchecked: true }),
      () => {}
    );
    expect((await prose.finish('One. Two.\n\nThree.')).grounding).toEqual({
      dropped: [],
      unchecked: 3,
    });
  });

  it('rejects finish on an abort without leaving an unhandled rejection', async () => {
    const prose = makeCheckedProse(
      () => Promise.reject(new Error('aborted')),
      () => {}
    );
    prose.push('Never finished.\n\n');
    await expect(prose.finish('Never finished.')).rejects.toThrow('aborted');
  });
});
