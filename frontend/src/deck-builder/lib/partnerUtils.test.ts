import { describe, it, expect } from 'vitest';
import {
  getPartnerType,
  getPartnerWithName,
  canHavePartner,
  areValidPartners,
  getPartnerTypeLabel,
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
    ['doctors-companion', 'Doctor'],
    ['doctor', "Doctor's Companion"],
    ['none', ''],
  ])('labels %s as "%s"', (type, label) => {
    expect(getPartnerTypeLabel(type)).toBe(label);
  });
});
