import { describe, it, expect } from 'vitest';
import {
  getPartnerType,
  getPartnerWithName,
  canHavePartner,
  areValidPartners,
  namedPartner,
  getPartnerTypeLabel,
  choosesColorBeforeGame,
  withChosenColor,
  chosenColorOf,
  type PartnerType,
} from './partnerUtils';
import type { ScryfallCard } from '@/deck-builder/types';

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return { name: 'Test', id: 'id', ...overrides } as ScryfallCard;
}

describe('getPartnerType', () => {
  it('detects a Background enchantment by type line', () => {
    expect(getPartnerType(card({ type_line: 'Legendary Enchantment — Background' }))).toBe(
      'background'
    );
  });

  it('detects a "Choose a Background" commander', () => {
    expect(
      getPartnerType(card({ oracle_text: 'Choose a Background', type_line: 'Legendary Creature' }))
    ).toBe('choose-background');
  });

  it("detects the Doctor's companion keyword", () => {
    expect(getPartnerType(card({ keywords: ["Doctor's companion"] }))).toBe('doctors-companion');
  });

  it('detects a Doctor creature subtype', () => {
    expect(getPartnerType(card({ type_line: 'Legendary Creature — Time Lord Doctor' }))).toBe(
      'doctor'
    );
  });

  it('detects Friends forever from oracle text', () => {
    expect(
      getPartnerType(card({ keywords: ['Partner'], oracle_text: 'Friends forever (text)' }))
    ).toBe('friends-forever');
  });

  it('detects "Partner with [Name]"', () => {
    expect(getPartnerType(card({ oracle_text: 'Partner with Pako, Arcane Retriever' }))).toBe(
      'partner-with'
    );
  });

  it('detects the generic Partner keyword', () => {
    expect(getPartnerType(card({ keywords: ['Partner'], oracle_text: 'Partner' }))).toBe('partner');
  });

  it('returns none for a plain commander', () => {
    expect(getPartnerType(card({ type_line: 'Legendary Creature — Elf' }))).toBe('none');
  });

  it('reads oracle text from card faces', () => {
    expect(
      getPartnerType(
        card({
          card_faces: [
            { oracle_text: 'Choose a Background' },
            { oracle_text: '' },
          ] as ScryfallCard['card_faces'],
        })
      )
    ).toBe('choose-background');
  });
});

describe('getPartnerWithName', () => {
  it('extracts the partnered card name', () => {
    expect(getPartnerWithName(card({ oracle_text: 'Partner with Kraum, Ludevic’s Opus' }))).toBe(
      'Kraum, Ludevic’s Opus'
    );
  });

  it('returns null when there is no "Partner with" clause', () => {
    expect(getPartnerWithName(card({ oracle_text: 'Flying' }))).toBeNull();
  });
});

describe('canHavePartner', () => {
  it('is true for a partner-capable card', () => {
    expect(canHavePartner(card({ keywords: ['Partner'], oracle_text: 'Partner' }))).toBe(true);
  });

  it('is false for a plain card', () => {
    expect(canHavePartner(card({}))).toBe(false);
  });
});

describe('areValidPartners', () => {
  const generic = (name: string) => card({ name, keywords: ['Partner'], oracle_text: 'Partner' });

  it('rejects a card partnered with itself', () => {
    expect(areValidPartners(generic('Same'), generic('Same'))).toBe(false);
  });

  it('pairs two generic Partner cards', () => {
    expect(areValidPartners(generic('A'), generic('B'))).toBe(true);
  });

  it('pairs "Partner with" only with the named card', () => {
    const ludevic = card({ name: 'Ludevic', oracle_text: 'Partner with Kraum' });
    const kraum = card({ name: 'Kraum' });
    const other = card({ name: 'Someone Else' });
    expect(areValidPartners(ludevic, kraum)).toBe(true);
    expect(areValidPartners(ludevic, other)).toBe(false);
    // Symmetric: works when the "Partner with" card is the second argument.
    expect(areValidPartners(kraum, ludevic)).toBe(true);
  });

  it('pairs Friends forever with Friends forever', () => {
    const ff = (name: string) =>
      card({ name, keywords: ['Partner'], oracle_text: 'Friends forever' });
    expect(areValidPartners(ff('A'), ff('B'))).toBe(true);
  });

  it('pairs Choose a Background with a Background, both orderings', () => {
    const cmdr = card({ name: 'Cmdr', oracle_text: 'Choose a Background' });
    const bg = card({ name: 'Bg', type_line: 'Legendary Enchantment — Background' });
    expect(areValidPartners(cmdr, bg)).toBe(true);
    expect(areValidPartners(bg, cmdr)).toBe(true);
  });

  it("pairs Doctor's companion with a Doctor, both orderings", () => {
    const companion = card({ name: 'Companion', keywords: ["Doctor's companion"] });
    const doctor = card({ name: 'The Doctor', type_line: 'Legendary Creature — Time Lord Doctor' });
    expect(areValidPartners(companion, doctor)).toBe(true);
    expect(areValidPartners(doctor, companion)).toBe(true);
  });

  it('rejects mismatched partner types', () => {
    const generic1 = generic('A');
    const ff = card({ name: 'B', keywords: ['Partner'], oracle_text: 'Friends forever' });
    expect(areValidPartners(generic1, ff)).toBe(false);
  });
});

describe('getPartnerTypeLabel', () => {
  it.each<[PartnerType, string]>([
    ['partner', 'Partner'],
    ['partner-with', 'Partner with'],
    ['friends-forever', 'Friends forever'],
    ['choose-background', 'Choose a Background'],
    ['background', 'Background'],
    ['doctors-companion', "Doctor's companion"],
    ['doctor', 'Doctor'],
    ['none', ''],
  ])('labels %s as "%s"', (type, label) => {
    expect(getPartnerTypeLabel(type)).toBe(label);
  });
});

// Real oracle text (Scryfall, 2026-09-24). Scryfall gives all three an empty
// color identity, which is why the choice has to be stamped onto the card.
const PIPER = card({
  name: 'The Prismatic Piper',
  type_line: 'Legendary Creature — Shapeshifter',
  keywords: ['Partner'],
  color_identity: [],
  oracle_text:
    'If The Prismatic Piper is your commander, choose a color before the game begins. The Prismatic Piper is the chosen color.\nPartner (You can have two commanders if both have partner.)',
});
const FACELESS_ONE = card({
  name: 'Faceless One',
  type_line: 'Legendary Enchantment Creature — Background',
  keywords: ['Choose a background'],
  color_identity: [],
  oracle_text:
    'If Faceless One is your commander, choose a color before the game begins. Faceless One is the chosen color.\nChoose a Background (You can have a Background as a second commander.)',
});

describe('choose-a-color commanders', () => {
  it('detects the before-the-game color choice from oracle text', () => {
    expect(choosesColorBeforeGame(PIPER)).toBe(true);
    expect(choosesColorBeforeGame(FACELESS_ONE)).toBe(true);
    expect(
      choosesColorBeforeGame(card({ oracle_text: 'Choose a color. Add one mana of that color.' }))
    ).toBe(false);
    expect(choosesColorBeforeGame(null)).toBe(false);
  });

  it('stamps the chosen color as both color and color identity, without mutating', () => {
    const red = withChosenColor(PIPER, 'R');
    expect(red.color_identity).toEqual(['R']);
    expect(red.colors).toEqual(['R']);
    expect(PIPER.color_identity).toEqual([]);
    expect(chosenColorOf(red)).toBe('R');
    expect(chosenColorOf(PIPER)).toBeNull();
    // An ordinary mono-red commander is not "a chosen color".
    expect(chosenColorOf(card({ color_identity: ['R'], oracle_text: 'Haste' }))).toBeNull();
  });

  it('treats Faceless One as the side that chooses a Background, and pairs it with one', () => {
    expect(getPartnerType(FACELESS_ONE)).toBe('choose-background');
    const bg = card({ name: 'Raised by Giants', type_line: 'Legendary Enchantment — Background' });
    expect(areValidPartners(FACELESS_ONE, bg)).toBe(true);
    expect(areValidPartners(bg, FACELESS_ONE)).toBe(true);
  });
});

const PAKO = card({
  name: 'Pako, Arcane Retriever',
  type_line: 'Legendary Creature — Elemental Dog',
  keywords: ['Partner with', 'Haste', 'Partner'],
  oracle_text:
    "Partner with Haldan, Avid Arcanist\nHaste\nWhenever Pako attacks, exile the top card of each player's library and put a fetch counter on each of them. Put a +1/+1 counter on Pako for each noncreature card exiled this way.",
});
const HALDAN = card({
  name: 'Haldan, Avid Arcanist',
  type_line: 'Legendary Creature — Human Wizard',
  keywords: ['Partner with', 'Partner'],
  oracle_text:
    'Partner with Pako, Arcane Retriever (When this creature enters, target player may put Pako into their hand from their library, then shuffle.)\nYou may play lands and cast noncreature spells from among cards you exiled that have fetch counters on them, and you may spend mana as though it were mana of any color to cast those spells.',
});

/** The partner a list named under its Commander header pairs only when the
 *  rules say the two pair; anything else stays in the 99. */
describe('namedPartner', () => {
  it('pairs a Partner with pair the list named', () => {
    expect(namedPartner(PAKO, HALDAN)).toBe(HALDAN);
  });

  it('refuses a card that does not pair, and a missing commander or partner', () => {
    const solRing = card({
      name: 'Sol Ring',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
    });
    expect(namedPartner(PAKO, solRing)).toBeNull();
    expect(namedPartner(null, HALDAN)).toBeNull();
    expect(namedPartner(PAKO, undefined)).toBeNull();
  });
});
