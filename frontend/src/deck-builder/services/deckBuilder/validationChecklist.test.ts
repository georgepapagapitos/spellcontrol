import { describe, expect, it } from 'vitest';
import { buildValidationChecklist, type ValidationInput } from './validationChecklist';

/** A 100-card Izzet deck: commander + 99 within {U,R}, no dupes. */
function legalDeck(): ValidationInput['cards'] {
  const cards: ValidationInput['cards'] = [
    { name: 'Niv-Mizzet, Parun', color_identity: ['U', 'R'], type_line: 'Legendary Creature' },
  ];
  for (let i = 0; i < 60; i++) cards.push({ name: `Spell ${i}`, color_identity: ['U'], cmc: 2 });
  for (let i = 0; i < 39; i++)
    cards.push({ name: 'Island', color_identity: [], type_line: 'Basic Land' });
  return cards;
}

/** Pauper/Modern/Standard shape: 60 cards, up to 4 copies of a name. */
const PAUPER = { deckSize: 60, maxCopies: 4 };

/** A legal 60-card mono-red list: 9 names × 4 copies + 24 Mountains. */
function sixtyCardFourOfDeck(): ValidationInput['cards'] {
  const cards: ValidationInput['cards'] = [];
  for (const name of ['Lightning Bolt', ...Array.from({ length: 8 }, (_, i) => `Spell ${i}`)])
    for (let i = 0; i < 4; i++) cards.push({ name, color_identity: ['R'], cmc: 1 });
  for (let i = 0; i < 24; i++)
    cards.push({ name: 'Mountain', color_identity: [], type_line: 'Basic Land' });
  return cards;
}

const ROLE_TARGETS = { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 };

describe('buildValidationChecklist', () => {
  it('passes the hard gates for a legal 100-card singleton deck', () => {
    const r = buildValidationChecklist({ cards: legalDeck(), commanderIdentity: ['U', 'R'] });
    const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    expect(byId.size.status).toBe('pass');
    expect(byId.identity.status).toBe('pass');
    expect(byId.singleton.status).toBe('pass');
    expect(r.hardFails).toBe(0);
  });

  it('fails deck size when not 100 cards', () => {
    const r = buildValidationChecklist({ cards: legalDeck().slice(0, 98) });
    expect(r.checks.find((c) => c.id === 'size')?.status).toBe('fail');
    expect(r.hardFails).toBe(1);
  });

  it('flags off-color cards against the commander identity', () => {
    const cards = legalDeck();
    cards.push({ name: 'Llanowar Elves', color_identity: ['G'], cmc: 1 }); // green → off-color
    const r = buildValidationChecklist({ cards, commanderIdentity: ['U', 'R'] });
    const identity = r.checks.find((c) => c.id === 'identity');
    expect(identity?.status).toBe('fail');
    expect(identity?.detail).toContain('1 off-color');
  });

  it('skips the identity gate when no commander identity is given', () => {
    const r = buildValidationChecklist({ cards: legalDeck() });
    expect(r.checks.some((c) => c.id === 'identity')).toBe(false);
  });

  it('flags duplicate non-basics but allows repeated basics', () => {
    const cards = legalDeck();
    cards.push({ name: 'Spell 0', color_identity: ['U'], cmc: 2 }); // dupe non-basic
    const r = buildValidationChecklist({ cards, commanderIdentity: ['U', 'R'] });
    expect(r.checks.find((c) => c.id === 'singleton')?.status).toBe('fail');
  });

  it('gates a 60-card 4-of format on its own size and copy limit', () => {
    const pauper = buildValidationChecklist({ cards: sixtyCardFourOfDeck(), format: PAUPER });
    const byId = Object.fromEntries(pauper.checks.map((c) => [c.id, c]));
    expect(byId.size.status).toBe('pass');
    expect(byId.size.detail).toBe('60 / 60 cards');
    expect(byId.singleton.status).toBe('pass'); // 4-ofs are legal here
    expect(byId.singleton.label).toBe('Copy limit');
    expect(pauper.hardFails).toBe(0);
  });

  it('flags a fifth copy in a 4-of format', () => {
    const cards = sixtyCardFourOfDeck();
    cards[59] = { name: 'Lightning Bolt', color_identity: ['R'], cmc: 1 }; // 5th Bolt
    const copyLimit = buildValidationChecklist({ cards, format: PAUPER }).checks.find(
      (c) => c.id === 'singleton'
    );
    expect(copyLimit?.status).toBe('fail');
    expect(copyLimit?.detail).toBe('1 name over 4 copies');
  });

  it('warns when a role target is short and passes when met', () => {
    const r = buildValidationChecklist({
      cards: legalDeck(),
      roleCounts: { ramp: 10, removal: 4, boardwipe: 3, cardDraw: 12 },
      roleTargets: ROLE_TARGETS,
    });
    const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    expect(byId.ramp.status).toBe('pass'); // 10 >= 10
    expect(byId.removal.status).toBe('warn'); // 4 < 8
    expect(byId.cardDraw.status).toBe('pass'); // 12 >= 10
    expect(byId.removal.detail).toBe('4 / 8');
  });

  it('omits role gates with no target and gates the curve', () => {
    const lean = buildValidationChecklist({ cards: legalDeck(), averageCmc: 2.8 });
    expect(lean.checks.some((c) => c.id === 'ramp')).toBe(false);
    expect(lean.checks.find((c) => c.id === 'curve')?.status).toBe('pass');

    const heavy = buildValidationChecklist({ cards: legalDeck(), averageCmc: 4.2 });
    expect(heavy.checks.find((c) => c.id === 'curve')?.status).toBe('warn');
  });
});
