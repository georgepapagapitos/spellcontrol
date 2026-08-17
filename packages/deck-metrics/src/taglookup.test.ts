import { describe, it, expect } from 'vitest';
import { createTagLookup, HARDCODED_GAME_CHANGERS, estimateBracket } from './index';

/**
 * `createTagLookup` encodes the role PRECEDENCE both apps depend on, and
 * `HARDCODED_GAME_CHANGERS` is the backend's ONLY source for a hard bracket
 * floor. Neither fails loudly when it is wrong — a dropped tag or a missing name
 * just produces a quietly lower bracket — so both are pinned here.
 */

describe('createTagLookup', () => {
  const tags = createTagLookup({
    boardwipe: ['Wrath of God'],
    removal: ['Wrath of God', 'Swords to Plowshares'],
    ramp: ['Cultivate'],
    'cost-reducer': ['Cloud Key'],
    'mana-dork': ['Llanowar Elves'],
    'mana-rock': ['Arcane Signet'],
    'card-advantage': ['Rhystic Study'],
    tutor: ['Demonic Tutor'],
    draw: ['Divination'],
    wheel: ['Windfall'],
    looting: ['Faithless Looting'],
    cantrip: ['Ponder'],
    'mass-land-denial': ['Armageddon'],
    'extra-turn': ['Time Warp'],
    tapland: ['Jungle Hollow'],
  });

  it('answers hasTag for a tag it has and one it does not', () => {
    expect(tags.hasTag('Ponder', 'cantrip')).toBe(true);
    expect(tags.hasTag('Ponder', 'boardwipe')).toBe(false);
    expect(tags.hasTag('Ponder', 'a-tag-that-does-not-exist')).toBe(false);
  });

  it('prefers boardwipe over removal — the more specific claim wins', () => {
    expect(tags.getCardRole('Wrath of God')).toBe('boardwipe');
    expect(tags.getCardRole('Swords to Plowshares')).toBe('removal');
  });

  it('folds all four ramp-ish tags into ramp', () => {
    for (const n of ['Cultivate', 'Cloud Key', 'Llanowar Elves', 'Arcane Signet']) {
      expect(tags.getCardRole(n)).toBe('ramp');
    }
  });

  it('folds all six draw-ish tags into cardDraw', () => {
    for (const n of [
      'Rhystic Study',
      'Demonic Tutor',
      'Divination',
      'Windfall',
      'Faithless Looting',
      'Ponder',
    ]) {
      expect(tags.getCardRole(n)).toBe('cardDraw');
    }
  });

  it('returns null for a tagged card whose tags carry no role, and for an unknown one', () => {
    expect(tags.getCardRole('Jungle Hollow')).toBeNull();
    expect(tags.getCardRole('Never Heard Of It')).toBeNull();
  });

  it('answers the two dedicated floor predicates', () => {
    expect(tags.isMassLandDenial('Armageddon')).toBe(true);
    expect(tags.isMassLandDenial('Ponder')).toBe(false);
    expect(tags.isExtraTurn('Time Warp')).toBe(true);
    expect(tags.isExtraTurn('Ponder')).toBe(false);
  });

  it('is inert rather than broken when built over no data at all', () => {
    // The server case this exists to make SAFE: an empty lookup must answer
    // false/null, and the caller is responsible for not offering the tool.
    const empty = createTagLookup({});
    expect(empty.getCardRole('Wrath of God')).toBeNull();
    expect(empty.isMassLandDenial('Armageddon')).toBe(false);
    expect(empty.isExtraTurn('Time Warp')).toBe(false);
    expect(empty.hasTag('Ponder', 'cantrip')).toBe(false);
  });
});

describe('HARDCODED_GAME_CHANGERS', () => {
  it('is the RC list at the size the comment claims', () => {
    expect(HARDCODED_GAME_CHANGERS.size).toBe(53);
  });

  it('carries the apostrophe and comma names exactly as Scryfall spells them', () => {
    // These are the ones a hand-maintained copy gets wrong.
    for (const n of ["Serra's Sanctum", 'Narset, Parter of Veils', "Lion's Eye Diamond"]) {
      expect(HARDCODED_GAME_CHANGERS.has(n)).toBe(true);
    }
  });

  it('actually drives a hard floor through estimateBracket', () => {
    const tags = createTagLookup({});
    const est = estimateBracket(
      ['Rhystic Study', 'Forest'],
      [],
      2,
      undefined,
      undefined,
      new Set(HARDCODED_GAME_CHANGERS),
      tags
    );
    expect(est.breakdown.gameChangerNames).toContain('Rhystic Study');
    expect(est.hardFloors.length).toBeGreaterThan(0);
  });
});
