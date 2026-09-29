// @vitest-environment node
//
// The deck-invariant checker's commander checks over real cards (the Scryfall
// objects the live stress panel resolved, __fixtures__/commander-cards.fixture
// .json, and the pinned tagger snapshot):
//   - E524: a cost reducer is dead against the EFFECTIVE identity, a
//     choose-a-color commander's chosen color.
//   - E530: a deck built around a command zone the format doesn't allow is
//     HARD; a previewed commander is SOFT with its disclosure, HARD without.
// The rest of the checker's tests are in deckInvariants.test.ts.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { withChosenColor } from '@/deck-builder/lib/partnerUtils';
import { commanderPreviewNote } from './commanderEligibility';
import { checkDeckInvariants } from './deckInvariants';
import {
  CARDS,
  assemble,
  card,
  checks,
  cleanCategories,
  commanderCard,
  context,
  customization,
  loadTaggerSnapshot,
  swap,
} from './__fixtures__/invariant-deck';

beforeAll(loadTaggerSnapshot);

afterAll(() => vi.unstubAllGlobals());

describe('commander checks', () => {
  // E524: the live Prismatic Piper row, chosen green. The dead-card check
  // reads the deck's EFFECTIVE identity, the chosen color.
  it('flags a reducer for a color a choose-a-color commander did not choose', () => {
    const cats = cleanCategories();
    swap(cats, 'Negate', card('Ruby Medallion'));
    const piper = withChosenColor(commanderCard('The Prismatic Piper'), 'G');
    const v = checkDeckInvariants(
      assemble(cats, { commander: piper }),
      context({ commander: piper, colorIdentity: ['G'] })
    );
    expect(v.find((x) => x.check === 'dead-in-identity')).toMatchObject({
      level: 'HARD',
      detail: "Ruby Medallion discounts a color the deck can't cast (identity [G])",
    });
  });

  // E530: the generator refuses these at its entry, so a deck built around
  // one got past the gate.
  it('flags a deck built around a commander the format does not allow', () => {
    const cats = cleanCategories();
    const elves = card('Llanowar Elves');
    const v = checkDeckInvariants(
      assemble(cats, { commander: elves }),
      context({ commander: elves })
    );
    expect(v.find((x) => x.check === 'commander-legality')).toEqual({
      level: 'HARD',
      check: 'commander-legality',
      detail:
        "a deck was built for an illegal command zone (not-a-commander): Llanowar Elves isn't a legendary creature, so it can't be your commander.",
    });
    const pdh = checkDeckInvariants(
      assemble(cats),
      context({
        commander: commanderCard("Atraxa, Praetors' Voice"),
        customization: customization({ mtgFormat: 'paupercommander' }),
      })
    );
    expect(pdh.find((x) => x.check === 'commander-legality')?.detail).toContain(
      "isn't an uncommon creature"
    );
  });

  it('flags a second commander that does not pair with the first', () => {
    const v = checkDeckInvariants(
      assemble(cleanCategories()),
      context({ partnerCommander: card('Kenrith, the Returned King') })
    );
    expect(v.find((x) => x.check === 'commander-legality')?.detail).toContain(
      "Kenrith, the Returned King can't be a second commander with Tatyova, Benthic Druid."
    );
  });

  // USER RULING (second pass): a previewed commander builds, but only with
  // its disclosure.
  it('keeps a previewed commander SOFT with its note, HARD without it', () => {
    const seven = commanderCard('Seven of Nine');
    // Pinned "today": Seven of Nine releases 2026-11-13.
    const now = new Date('2026-09-29T12:00:00');
    const note = commanderPreviewNote(seven, null, 'commander', now);
    expect(note).toMatch(/^Seven of Nine isn't legal until /);
    const ctx = context({ commander: seven, colorIdentity: ['G', 'U'], now });
    const disclosed = checkDeckInvariants(
      assemble(cleanCategories(), { commander: seven, commanderPreviewNote: note }),
      ctx
    ).filter((x) => x.check === 'commander-legality');
    expect(disclosed.map((x) => x.level)).toEqual(['SOFT']);
    const silent = checkDeckInvariants(
      assemble(cleanCategories(), { commander: seven }),
      ctx
    ).filter((x) => x.check === 'commander-legality');
    expect(silent).toEqual([
      {
        level: 'HARD',
        check: 'commander-legality',
        detail: `previewed commander: ${note} (undisclosed)`,
      },
    ]);
  });

  it('accepts every legal commander and pair on the stress panel', () => {
    for (const [a, b] of [
      ['Thrasios, Triton Hero', 'Tymna the Weaver'],
      ['Wilson, Refined Grizzly', 'Raised by Giants'],
      ['Lutri, the Spellchaser', null],
      ['Grist, the Hunger Tide', null],
      ['Commodore Guff', null],
    ] as const) {
      const commander = CARDS.has(a) ? card(a) : commanderCard(a);
      const partner = b ? (CARDS.has(b) ? card(b) : commanderCard(b)) : null;
      const v = checkDeckInvariants(
        assemble(cleanCategories()),
        context({ commander, partnerCommander: partner })
      );
      expect(checks(v), `${a} + ${b}`).not.toContain('commander-legality');
    }
  });
});
