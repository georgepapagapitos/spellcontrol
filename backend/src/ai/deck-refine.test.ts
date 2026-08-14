import { describe, it, expect } from 'vitest';
import {
  MAX_TWEAKS,
  TWEAKS_DELIMITER,
  buildRefineMessage,
  hashRefineInput,
  parseRefineOutput,
  parseRefineRequest,
  type RefineRequest,
} from './deck-refine';

const card = (name: string, qty = 1) => ({ name, oracleId: `o-${name}`, qty });

const REQ: RefineRequest = {
  deckId: 'd1',
  commander: 'Kaalia of the Vast',
  cards: [card('Sol Ring'), card('Lightning Greaves'), card('Swamp', 11)],
  pool: [card('Boros Signet'), card('Orzhov Signet'), card('Burnished Hart')],
  ownedOnly: false,
  analysis: { totalNonCommander: 13 },
};

/** Assemble a model reply in the shape the prompt asks for. */
const reply = (prose: string, tweaks: unknown) =>
  `${prose}\n\n${TWEAKS_DELIMITER}\n${JSON.stringify(tweaks)}`;

describe('parseRefineOutput — the model curates, it never invents', () => {
  it('keeps a well-formed tweak and splits the prose off', () => {
    const out = parseRefineOutput(
      reply('Your deck cheats fatties into play.', [
        {
          add: 'Boros Signet',
          cut: 'Lightning Greaves',
          why: 'You need mana, not haste enablers.',
        },
      ]),
      REQ
    );
    expect(out.strategy).toBe('Your deck cheats fatties into play.');
    expect(out.tweaks).toEqual([
      { add: 'Boros Signet', cut: 'Lightning Greaves', why: 'You need mana, not haste enablers.' },
    ]);
    expect(out.rejected).toEqual([]);
  });

  it('DROPS a card that is not in the pool, however famous', () => {
    // The single most important assertion in this file: a staple the model
    // "knows" is good, but the engine never offered, must not reach the user.
    const out = parseRefineOutput(
      reply('Prose.', [
        { add: 'Mana Crypt', cut: 'Lightning Greaves', why: 'Fast mana.' },
        { add: 'Boros Signet', cut: null, why: 'Fixes and ramps on curve.' },
      ]),
      REQ
    );
    expect(out.tweaks.map((t) => t.add)).toEqual(['Boros Signet']);
    expect(out.rejected).toEqual(['Mana Crypt']);
  });

  it('drops a cut that is not in the decklist', () => {
    const out = parseRefineOutput(
      reply('Prose.', [{ add: 'Boros Signet', cut: 'Mana Vault', why: 'Swap the rock.' }]),
      REQ
    );
    expect(out.tweaks).toEqual([]);
    expect(out.rejected).toEqual(['Mana Vault']);
  });

  it('never lets the commander be cut', () => {
    const out = parseRefineOutput(
      reply('Prose.', [{ add: 'Boros Signet', cut: 'Kaalia of the Vast', why: 'Too slow.' }]),
      REQ
    );
    expect(out.tweaks).toEqual([]);
  });

  it('accepts a case-slipped name but resolves it to the pool spelling', () => {
    const out = parseRefineOutput(
      reply('Prose.', [{ add: 'boros signet', cut: 'sol ring', why: 'A deliberate downgrade.' }]),
      REQ
    );
    expect(out.tweaks[0]).toMatchObject({ add: 'Boros Signet', cut: 'Sol Ring' });
  });

  it('rejects a no-op: adding a card the deck already runs', () => {
    const withDup = { ...REQ, pool: [...REQ.pool, card('Sol Ring')] };
    const out = parseRefineOutput(
      reply('Prose.', [{ add: 'Sol Ring', cut: 'Lightning Greaves', why: 'More ramp.' }]),
      withDup
    );
    expect(out.tweaks).toEqual([]);
  });

  it('refuses to spend one cut twice, or add one card twice', () => {
    const out = parseRefineOutput(
      reply('Prose.', [
        { add: 'Boros Signet', cut: 'Lightning Greaves', why: 'Ramp over haste.' },
        { add: 'Orzhov Signet', cut: 'Lightning Greaves', why: 'Ramp over haste again.' },
        { add: 'Boros Signet', cut: null, why: 'And once more.' },
      ]),
      REQ
    );
    expect(out.tweaks).toHaveLength(1);
    expect(out.tweaks[0].add).toBe('Boros Signet');
  });

  it(`caps at ${MAX_TWEAKS} however many the model returns`, () => {
    const pool = Array.from({ length: 9 }, (_, i) => card(`Filler ${i}`));
    const out = parseRefineOutput(
      reply(
        'Prose.',
        pool.map((c) => ({ add: c.name, cut: null, why: 'A perfectly good reason.' }))
      ),
      { ...REQ, pool }
    );
    expect(out.tweaks).toHaveLength(MAX_TWEAKS);
  });

  it('drops an entry with no reason — an unexplained swap is not a suggestion', () => {
    const out = parseRefineOutput(
      reply('Prose.', [
        { add: 'Boros Signet', cut: null, why: '   ' },
        { add: 'Orzhov Signet', cut: null, why: 'Fixes your heaviest colour pair.' },
      ]),
      REQ
    );
    expect(out.tweaks.map((t) => t.add)).toEqual(['Orzhov Signet']);
  });

  it('keeps the prose when the JSON tail is malformed', () => {
    // A broken tail costs the tweaks, never the strategy read.
    const out = parseRefineOutput(`Your deck is fine.\n\n${TWEAKS_DELIMITER}\n[{oops`, REQ);
    expect(out.strategy).toBe('Your deck is fine.');
    expect(out.tweaks).toEqual([]);
  });

  it('handles a reply with no delimiter at all as pure prose', () => {
    const out = parseRefineOutput('Just the prose, no tail.', REQ);
    expect(out.strategy).toBe('Just the prose, no tail.');
    expect(out.tweaks).toEqual([]);
  });

  it('digs the array out of a code fence', () => {
    const out = parseRefineOutput(
      `Prose.\n\n${TWEAKS_DELIMITER}\n\`\`\`json\n[{"add":"Burnished Hart","cut":null,"why":"Fetches lands and fixes."}]\n\`\`\``,
      REQ
    );
    expect(out.tweaks.map((t) => t.add)).toEqual(['Burnished Hart']);
  });

  it('an empty array is a valid, meaningful answer', () => {
    const out = parseRefineOutput(reply('This deck is already coherent.', []), REQ);
    expect(out.strategy).toBe('This deck is already coherent.');
    expect(out.tweaks).toEqual([]);
  });
});

describe('hashRefineInput', () => {
  it('is stable under reordering of deck and pool', () => {
    const flipped: RefineRequest = {
      ...REQ,
      cards: [...REQ.cards].reverse(),
      pool: [...REQ.pool].reverse(),
    };
    expect(hashRefineInput(REQ)).toBe(hashRefineInput(flipped));
  });

  it('changes when the POOL changes — a different pool is a different question', () => {
    const other = { ...REQ, pool: [...REQ.pool, card('Fellwar Stone')] };
    expect(hashRefineInput(REQ)).not.toBe(hashRefineInput(other));
  });

  it('changes when owned-only flips, since the answer must differ', () => {
    expect(hashRefineInput(REQ)).not.toBe(hashRefineInput({ ...REQ, ownedOnly: true }));
  });
});

describe('parseRefineRequest', () => {
  const body = () => ({
    deckId: 'd1',
    commander: 'Kaalia of the Vast',
    cards: [{ name: 'Sol Ring', oracleId: 'o', qty: 1 }],
    pool: [{ name: 'Boros Signet', oracleId: 'o', qty: 1 }],
    analysis: {},
  });

  it('accepts a well-formed body and defaults ownedOnly to false', () => {
    const res = parseRefineRequest(body());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.ownedOnly).toBe(false);
  });

  it('accepts an empty pool — nothing to offer is a valid state', () => {
    const res = parseRefineRequest({ ...body(), pool: [] });
    expect(res.ok).toBe(true);
  });

  it.each([
    ['missing deckId', { deckId: '' }],
    ['blank commander', { commander: '  ' }],
    ['no cards', { cards: [] }],
    ['pool that is not an array', { pool: 'nope' }],
    ['a card with a bad qty', { cards: [{ name: 'x', oracleId: 'o', qty: 0 }] }],
    ['analysis that is an array', { analysis: [] }],
  ])('rejects %s', (_label, override) => {
    expect(parseRefineRequest({ ...body(), ...override }).ok).toBe(false);
  });
});

describe('buildRefineMessage', () => {
  it('labels the pool as owned-only so the prompt rule can bind', () => {
    const msg = buildRefineMessage({ ...REQ, ownedOnly: true }, []);
    expect(msg).toContain('OWNED ONLY');
    expect(msg).toContain('Boros Signet');
  });

  it('says so explicitly when the pool is empty', () => {
    const msg = buildRefineMessage({ ...REQ, pool: [] }, []);
    expect(msg).toContain('propose nothing');
  });
});
