// @vitest-environment node
//
// E530 over real cards: every commander below is the Scryfall object the live
// stress panel resolved (__fixtures__/commander-cards.fixture.json, plus
// invariant-cards.fixture.json for Llanowar Elves, Tatyova and the partners).
// USER RULING 2026-09-29: an illegal commander refuses to build, naming why.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Customization, ScryfallCard } from '@/deck-builder/types';
import { withChosenColor } from '@/deck-builder/lib/partnerUtils';
import {
  assertCommandersEligible,
  commanderIneligibility,
  CommanderIneligibleError,
} from './commanderEligibility';

const here = dirname(fileURLToPath(import.meta.url));
const CARDS = new Map<string, ScryfallCard>();
for (const file of ['commander-cards.fixture.json', 'invariant-cards.fixture.json']) {
  const { cards } = JSON.parse(readFileSync(resolve(here, '__fixtures__', file), 'utf8')) as {
    cards: ScryfallCard[];
  };
  for (const c of cards) CARDS.set(c.name, c);
}

function card(name: string, patch: Partial<ScryfallCard> = {}): ScryfallCard {
  const c = CARDS.get(name);
  if (!c) throw new Error(`no fixture card named ${name}`);
  return { ...structuredClone(c), ...patch };
}

// The stress panel's "today": Seven of Nine and friends release 2026-11-13.
const NOW = new Date('2026-09-29T12:00:00Z');

function why(
  commander: string | ScryfallCard,
  partner?: string | ScryfallCard | null,
  mtgFormat?: Customization['mtgFormat'],
  now = NOW
) {
  const a = typeof commander === 'string' ? card(commander) : commander;
  const b = typeof partner === 'string' ? card(partner) : (partner ?? null);
  return commanderIneligibility(a, b, mtgFormat, now);
}

describe('commanderIneligibility: the three rows the ruling named', () => {
  it('refuses Atraxa in Pauper Commander: it was never an uncommon creature', () => {
    expect(why("Atraxa, Praetors' Voice", null, 'paupercommander')).toEqual({
      cardName: "Atraxa, Praetors' Voice",
      reason: 'pdh-not-uncommon-creature',
      message:
        "Atraxa, Praetors' Voice isn't an uncommon creature, so it can't lead a Pauper Commander deck.",
    });
    // The same card leads a Commander deck.
    expect(why("Atraxa, Praetors' Voice", null, 'commander')).toBeNull();
  });

  it('refuses Llanowar Elves anywhere but Pauper Commander: it is not legendary', () => {
    expect(why('Llanowar Elves')?.message).toBe(
      "Llanowar Elves isn't a legendary creature, so it can't be your commander."
    );
    expect(why('Llanowar Elves', null, 'brawl')?.message).toBe(
      "Llanowar Elves isn't a legendary creature or planeswalker, so it can't be your commander."
    );
    // PDH leads with an uncommon creature, legendary or not; Llanowar Elves'
    // stored printing is common.
    expect(why('Llanowar Elves', null, 'paupercommander')?.reason).toBe(
      'pdh-not-uncommon-creature'
    );
  });

  it('builds with Lutri in Commander: it is banned as a companion, not as a commander', () => {
    // Wizards' Commander list, checked 2026-09-29: "Lutri, the Spellchaser -
    // only banned as a companion." Scryfall reads it legal in Commander.
    expect(why('Lutri, the Spellchaser')).toBeNull();
    // Brawl bans it outright.
    expect(why('Lutri, the Spellchaser', null, 'brawl')).toMatchObject({
      reason: 'banned',
      message: 'Lutri, the Spellchaser is banned in Brawl.',
    });
  });
});

describe('commanderIneligibility: legality', () => {
  it('names a banned commander', () => {
    expect(why('Rofellos, Llanowar Emissary')?.message).toBe(
      'Rofellos, Llanowar Emissary is banned in Commander.'
    );
    expect(why('Griselbrand')?.reason).toBe('banned');
  });

  it('refuses an unreleased commander until it releases, then only on legality', () => {
    expect(why('Seven of Nine')).toMatchObject({
      reason: 'unreleased',
      message: "Seven of Nine isn't legal in Commander until it releases.",
    });
    // A Spacecraft with a power/toughness box passes the type rule, so only
    // the release date stands in the way.
    expect(why('U.S.S. Enterprise-D, Galaxy-Class')?.reason).toBe('unreleased');
    // After the date, Scryfall's own not_legal is the answer.
    expect(why('Seven of Nine', null, 'commander', new Date('2027-01-01'))).toMatchObject({
      reason: 'not-legal',
      message: "Seven of Nine isn't legal in Commander.",
    });
  });

  it('treats a missing legality record as not legal, like isValidCommander', () => {
    expect(why(card('Krenko, Mob Boss', { legalities: {} as ScryfallCard['legalities'] }))).toEqual(
      expect.objectContaining({ reason: 'not-legal' })
    );
  });
});

describe('commanderIneligibility: what can be a commander (CR 903.3)', () => {
  it.each([
    'Krenko, Mob Boss',
    'Tatyova, Benthic Druid',
    'Karn, Legacy Reforged',
    'Lurrus of the Dream-Den',
    // "Commodore Guff can be your commander."
    'Commodore Guff',
    // A creature card everywhere but the battlefield.
    'Grist, the Hunger Tide',
    // The front face decides: Legendary Creature — God.
    'Esika, God of the Tree // The Prismatic Bridge',
    // A legendary Vehicle, and a Spacecraft with a power/toughness box.
    'Weatherlight',
    'The Seriema',
    // A Background that is itself a legendary creature.
    'Faceless One',
  ])('%s can lead a Commander deck', (name) => {
    expect(why(name)).toBeNull();
  });

  it('refuses a Spacecraft with no power/toughness box, and a lone Background', () => {
    expect(why('The Eternity Elevator')?.reason).toBe('not-a-commander');
    expect(why('Raised by Giants')?.reason).toBe('not-a-commander');
  });

  it('lets any legendary planeswalker lead a Brawl deck, but not a Commander deck', () => {
    expect(why('Liliana, Dreadhorde General', null, 'brawl')).toBeNull();
    expect(why('Liliana, Dreadhorde General', null, 'commander')?.message).toBe(
      "Liliana, Dreadhorde General isn't a legendary creature, so it can't be your commander."
    );
  });

  it('checks a choose-a-color commander the same once its color is stamped', () => {
    expect(why(withChosenColor(card('The Prismatic Piper'), 'G'))).toBeNull();
  });
});

describe('commanderIneligibility: pairs', () => {
  it.each([
    ['Thrasios, Triton Hero', 'Tymna the Weaver'],
    ['Wilson, Refined Grizzly', 'Raised by Giants'],
    ['Raised by Giants', 'Wilson, Refined Grizzly'],
    ['Clara Oswald', 'The Tenth Doctor'],
    ['The Tenth Doctor', 'Rose Tyler'],
    ['Pir, Imaginative Rascal', 'Toothy, Imaginary Friend'],
  ])('%s with %s is a legal pair', (a, b) => {
    const first = a === 'Clara Oswald' ? withChosenColor(card(a), 'U') : card(a);
    expect(why(first, b)).toBeNull();
  });

  it('refuses a second commander that does not pair with the first', () => {
    // The stress panel's choose-color-partner row: the Piper has Partner,
    // Kenrith has none.
    expect(
      why(withChosenColor(card('The Prismatic Piper'), 'R'), 'Kenrith, the Returned King')
    ).toEqual({
      cardName: 'Kenrith, the Returned King',
      reason: 'invalid-pair',
      message: "Kenrith, the Returned King can't be a second commander with The Prismatic Piper.",
    });
    expect(why('Pir, Imaginative Rascal', 'Tymna the Weaver')?.reason).toBe('invalid-pair');
  });

  it('checks each card before the pairing', () => {
    expect(why('Thrasios, Triton Hero', 'Rofellos, Llanowar Emissary')?.reason).toBe('banned');
  });
});

describe('assertCommandersEligible', () => {
  it('throws a typed error carrying the reason, and returns for a legal zone', () => {
    const run = () =>
      assertCommandersEligible({
        commander: card('Llanowar Elves'),
        partnerCommander: null,
        customization: { mtgFormat: 'commander' },
      });
    expect(run).toThrow(CommanderIneligibleError);
    expect(run).toThrow(
      "Llanowar Elves isn't a legendary creature, so it can't be your commander."
    );
    try {
      run();
    } catch (e) {
      expect((e as CommanderIneligibleError).reason).toBe('not-a-commander');
      expect((e as CommanderIneligibleError).cardName).toBe('Llanowar Elves');
    }
    expect(() =>
      assertCommandersEligible({
        commander: card('Thrasios, Triton Hero'),
        partnerCommander: card('Tymna the Weaver'),
        customization: {},
      })
    ).not.toThrow();
  });
});
