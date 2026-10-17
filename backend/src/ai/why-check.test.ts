import { describe, it, expect } from 'vitest';
import {
  WHY_CHECK_SYSTEM_PROMPT,
  applyWhyCheck,
  buildWhyCheckMessage,
  checkWhys,
  namedIn,
} from './why-check';

// Real oracle text (Scryfall, 2026-10-16): the reading that opened E1027 added
// Koth because it "doubles up with Zo-Zu's trigger". Zo-Zu hits the land's
// controller, Koth hits each opponent.
const ZOZU = {
  name: 'Zo-Zu the Punisher',
  manaCost: '{1}{R}{R}',
  typeLine: 'Legendary Creature — Goblin Warrior',
  oracleText: "Whenever a land enters, Zo-Zu deals 2 damage to that land's controller.",
};
const KOTH = {
  name: 'Koth, the Geomancer',
  manaCost: '{2}{R}',
  typeLine: 'Legendary Creature — Human Warrior',
  oracleText:
    'Reach\nLandfall — Whenever a land you control enters, Koth deals 1 damage to each opponent. If that land is a Mountain, add {R}.',
};
const RITUAL = {
  name: 'Pyretic Ritual',
  manaCost: '{1}{R}',
  typeLine: 'Instant',
  oracleText: 'Add {R}{R}{R}.',
};
const KOTH_TWEAK = {
  add: 'Koth, the Geomancer',
  cut: 'Pyretic Ritual',
  why: "Koth's landfall doubles up with Zo-Zu the Punisher's trigger.",
};
const SOL_RING = { add: 'Sol Ring', cut: null, why: 'Two colorless mana for one.' };

describe('buildWhyCheckMessage', () => {
  const message = buildWhyCheckMessage({
    commanders: ['Zo-Zu the Punisher'],
    tweaks: [KOTH_TWEAK],
    decklist: [
      { name: 'Pyretic Ritual', qty: 1 },
      { name: 'Mountain', qty: 27 },
    ],
    oracle: [ZOZU, KOTH, RITUAL, { name: 'Mountain', typeLine: 'Basic Land — Mountain' }],
    analysis: { lands: 32 },
  });

  it('gives the full text of the add, the cut and the commander', () => {
    expect(message).toContain("deals 2 damage to that land's controller");
    expect(message).toContain('Koth deals 1 damage to each opponent');
    expect(message).toContain('Pyretic Ritual {1}{R} — Instant: Add {R}{R}{R}.');
  });

  it('numbers the change and lists the deck by type line', () => {
    expect(message).toContain('1. ADD Koth, the Geomancer / CUT Pyretic Ritual');
    expect(message).toContain('27 Mountain — Basic Land — Mountain');
    expect(message).toContain('## Decklist (28)');
  });

  it('marks a card it has no text for instead of leaving it blank', () => {
    const m = buildWhyCheckMessage({
      commanders: ['Zo-Zu the Punisher'],
      tweaks: [{ add: 'Unknown Card', cut: null, why: 'It helps.' }],
      decklist: [],
      oracle: [ZOZU],
      analysis: {},
    });
    expect(m).toContain('1. ADD Unknown Card (no cut)');
    expect(m).toContain('Unknown Card (no text on file)');
  });
});

describe('namedIn', () => {
  it('finds whole names only', () => {
    expect(namedIn('Pairs with Sol Ring early.', ['Sol Ring', 'Ring', 'Sol'])).toEqual([
      'Sol Ring',
      'Ring',
      'Sol',
    ]);
    expect(namedIn('Solemn Simulacrum ramps.', ['Sol'])).toEqual([]);
  });

  it('finds a legendary card by its short name, and a double-faced card by either face', () => {
    // Refine writes "Kiki-Jiki"; until this matched, the check never got Kiki-Jiki's text.
    const deck = ['Kiki-Jiki, Mirror Breaker', 'Delver of Secrets // Insectile Aberration'];
    expect(namedIn('Every Kiki-Jiki copy burns.', deck)).toEqual(['Kiki-Jiki, Mirror Breaker']);
    expect(namedIn('Flips into Insectile Aberration.', deck)).toEqual([
      'Delver of Secrets // Insectile Aberration',
    ]);
  });
});

/** A checker reply for one change whose claims hold or fail in this order. */
const claims = (...holds: boolean[]) =>
  JSON.stringify([
    {
      n: 1,
      claims: holds.map((h, i) => ({ claim: `claim ${i + 1}`, text: 'q', reading: 'r', holds: h })),
    },
  ]);

describe('applyWhyCheck', () => {
  it('keeps a change only when every claim holds', () => {
    expect(applyWhyCheck(claims(true, true), [SOL_RING])).toEqual({
      tweaks: [SOL_RING],
      dropped: [],
    });
    expect(applyWhyCheck(claims(true, false), [KOTH_TWEAK])).toEqual({
      tweaks: [],
      dropped: [{ add: KOTH_TWEAK.add, why: KOTH_TWEAK.why, failed: ['claim 2'] }],
    });
  });

  it('keeps a change whose reason makes no factual claim', () => {
    expect(applyWhyCheck('[{"n":1,"claims":[]}]', [SOL_RING])?.tweaks).toEqual([SOL_RING]);
  });

  it('reads an array wrapped in a code fence', () => {
    const fence = '```';
    expect(applyWhyCheck(`${fence}json\n${claims(true)}\n${fence}`, [SOL_RING])?.tweaks).toEqual([
      SOL_RING,
    ]);
  });

  it('returns null for a reply that is not a claim list for every change', () => {
    expect(applyWhyCheck('Everything checks out.', [SOL_RING])).toBeNull();
    expect(applyWhyCheck('[{"n":1,"claims":[]', [SOL_RING])).toBeNull();
    expect(applyWhyCheck('{"n":1}', [SOL_RING])).toBeNull();
    expect(applyWhyCheck('[{"n":1,"claims":[]}]', [SOL_RING, KOTH_TWEAK])).toBeNull();
    expect(
      applyWhyCheck('[{"n":1,"claims":[{"claim":"x","holds":"yes"}]}]', [SOL_RING])
    ).toBeNull();
    expect(applyWhyCheck('[{"n":1,"claims":[null]}]', [SOL_RING])).toBeNull();
    expect(applyWhyCheck('[null, {"n":"1","claims":[]}]', [SOL_RING])).toBeNull();
    // Two arrays in one reply (seen once live) is not one claim list.
    expect(
      applyWhyCheck(`${claims(true)}\n\nNote: fixed.\n\n${claims(true)}`, [SOL_RING])
    ).toBeNull();
  });
});

describe('checkWhys', () => {
  const input = {
    commanders: ['Zo-Zu the Punisher'],
    tweaks: [KOTH_TWEAK, SOL_RING],
    decklist: [{ name: 'Pyretic Ritual', qty: 1 }],
    oracle: [ZOZU, KOTH, RITUAL],
    analysis: {},
  };

  it('checks each change in its own call and sums the usage', async () => {
    const users: string[] = [];
    const run = await checkWhys(input, async (system, user) => {
      expect(system).toBe(WHY_CHECK_SYSTEM_PROMPT);
      users.push(user);
      return {
        content: user.includes('ADD Koth') ? claims(false) : claims(true),
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 1,
      };
    });
    expect(users).toHaveLength(2);
    expect(users.every((u) => (u.match(/^\d+\. ADD /gm) ?? []).length === 1)).toBe(true);
    expect(run.tweaks).toEqual([SOL_RING]);
    expect(run.dropped.map((d) => d.add)).toEqual([KOTH_TWEAK.add]);
    expect(run.unchecked).toEqual([]);
    expect(run.usage).toEqual({
      inputTokens: 200,
      outputTokens: 20,
      cacheWriteTokens: 0,
      cacheReadTokens: 2,
    });
  });

  it('keeps a change as written, in order, when its check errors or does not parse', async () => {
    const run = await checkWhys(input, async (_s, user) => {
      if (user.includes('ADD Koth')) throw new Error('overloaded');
      return { content: 'Looks right.' };
    });
    expect(run.tweaks).toEqual([KOTH_TWEAK, SOL_RING]);
    expect(run.unchecked).toEqual([KOTH_TWEAK.add, SOL_RING.add]);
  });

  it('rethrows once the request is aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      checkWhys(
        input,
        async () => {
          throw new Error('aborted');
        },
        ac.signal
      )
    ).rejects.toThrow('aborted');
  });
});
