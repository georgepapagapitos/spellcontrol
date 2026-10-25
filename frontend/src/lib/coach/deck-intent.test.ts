// Guard (E1038 3.2, the intent adapter): Coach follows what the deck is for.
// A casual deck no longer gets its theme card swapped for a generic staple, a
// Bracket 2 deck never gets a Game Changer, a combo that floors it at 4, mass
// land denial or an extra-turn chain, and a Spike deck's interaction and speed lead.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/deck-builder/services/tagger/client', async (orig) => ({
  ...(await orig<object>()),
  isExtraTurn: (n: string) => n.startsWith('Fixture Walk') || n.startsWith('Time Fixture'),
  isMassLandDenial: (n: string) => n === 'Fixture Armageddon',
  hasTag: (n: string, t: string) => n === 'Demonic Tutor' && t === 'tutor',
  getCardRole: (n: string) => (n === 'Demonic Tutor' ? 'cardDraw' : null),
}));
import type { ScryfallCard } from '@/deck-builder/types';
import { COACH_CARDS } from '@/deck-builder/services/deckBuilder/__fixtures__/coach-cards.fixtures';
import { fromComboCompletion, fromGapCard, type Change } from './deck-change';
import { rankCoachMoves, type CoachContext } from './coach-rank';
import { deckIntent } from './deck-intent';
import {
  coachDeckSettings,
  settingsBreak,
  type CoachDeckSettings,
  type SettingsFitDeck,
} from './deck-settings-fit';
import type { ComboMatch } from '@/types/combos';

const real = (name: string): ScryfallCard => ({ ...COACH_CARDS[name] });
const generation = (targetBracket: 1 | 2 | 3 | 4 | 5, brewLevel?: number) => ({
  generationContext: {
    selectedThemes: [],
    targetBracket,
    landCount: 37,
    collectionMode: false,
    customization: brewLevel === undefined ? {} : { brewLevel },
  },
  bracketOverride: null,
});
const settingsFor = (targetBracket: 1 | 2 | 3 | 4 | 5, brewLevel?: number): CoachDeckSettings => {
  const s = coachDeckSettings(generation(targetBracket, brewLevel));
  if (!s) throw new Error('expected settings');
  return s;
};
const deckOf = (cards: ScryfallCard[]): SettingsFitDeck => ({
  cards,
  isOwned: () => false,
  full: true,
});
const swap = (over: Partial<Change>): Change => ({
  id: 'swap:x',
  type: 'swap',
  lane: 'upgrade',
  name: 'Arcane Signet',
  inName: 'Blood Artist',
  inclusion: 80,
  synergy: 0,
  ...over,
});
// Blood Artist is the deck's theme card; Doom Blade is not.
const themeDeck = deckOf([
  { ...real('Blood Artist'), isThemeSynergyCard: true },
  real('Doom Blade'),
]);

describe('deckIntent', () => {
  it('reads the dial first, then the bracket', () => {
    expect(deckIntent(1, 4)).toBe('casual');
    expect(deckIntent(0.75, 'all')).toBe('casual');
    expect(deckIntent(undefined, 2)).toBe('casual');
    expect(deckIntent(undefined, 1)).toBe('casual');
    expect(deckIntent(undefined, 4)).toBe('spike');
    expect(deckIntent(0.25, 5)).toBe('spike');
  });

  it('reads nothing into a deck that states nothing, or a staples-leaning Bracket 2', () => {
    expect(deckIntent(undefined, 'all')).toBe('balanced');
    expect(deckIntent(undefined, 3)).toBe('balanced');
    expect(deckIntent(0.25, 2)).toBe('balanced');
    expect(deckIntent(0, 1)).toBe('balanced');
  });

  it('is on the deck settings a generated deck saved', () => {
    expect(settingsFor(3, 1).intent).toBe('casual');
    expect(deckIntent(undefined, 5)).toBe('spike');
    expect(settingsFor(3).intent).toBe('balanced');
  });
});

describe('a casual deck: no staple for its theme card', () => {
  const casual = settingsFor(3, 1);

  it('hides a generic staple swapped in for a theme card', () => {
    expect(settingsBreak(swap({}), casual, themeDeck)).toBe('staple-swap');
  });

  it('shows the same swap on a balanced deck', () => {
    expect(settingsBreak(swap({}), settingsFor(3, 0.5), themeDeck)).toBeNull();
    expect(settingsBreak(swap({}), { ...casual, intent: 'balanced' }, themeDeck)).toBeNull();
  });

  it('keeps an on-theme upgrade, a role gap and a staple for a card that is not theme', () => {
    expect(settingsBreak(swap({ isThemeSynergy: true }), casual, themeDeck)).toBeNull();
    expect(settingsBreak(swap({ group: 'fills:ramp' }), casual, themeDeck)).toBeNull();
    expect(settingsBreak(swap({ inName: 'Doom Blade' }), casual, themeDeck)).toBeNull();
    expect(settingsBreak(swap({ inclusion: 12 }), casual, themeDeck)).toBeNull();
  });

  it('keeps a staple added to an empty slot', () => {
    const add: Change = { ...swap({}), type: 'add', inName: undefined };
    expect(settingsBreak(add, casual, themeDeck)).toBeNull();
  });
});

describe('bracket restraint', () => {
  const b2 = settingsFor(2);
  const gap = (name: string) =>
    fromGapCard(
      { name, inclusion: 50, synergy: 0, typeLine: COACH_CARDS[name].type_line, price: null },
      'owned'
    );
  const deck = deckOf([real('Doom Blade')]);

  it('never offers a Bracket 2 deck a Game Changer', () => {
    expect(settingsBreak(gap('Rhystic Study'), b2, deck)).toBe('over-game-changers');
    expect(settingsBreak(gap('Imperial Seal'), b2, deck)).toBe('over-game-changers');
  });

  it('does not hide fast mana or tutors: Wizards has no rule for either', () => {
    expect(settingsBreak(gap('Mox Opal'), b2, deck)).toBeNull();
    expect(settingsBreak(gap('Sol Ring'), b2, deck)).toBeNull();
  });

  it('holds extra turns and mass land denial to the target', () => {
    const turn = (n: string): Change => ({ ...gap('Harmonize'), name: n });
    expect(settingsBreak(turn('Fixture Walk'), b2, deckOf([real('Doom Blade')]))).toBeNull();
    const two = deckOf([
      real('Doom Blade'),
      { ...real('Doom Blade'), name: 'Time Fixture' },
      { ...real('Doom Blade'), name: 'Time Fixture2' },
    ]);
    expect(settingsBreak(turn('Fixture Walk'), b2, two)).toBe('over-bracket');
    expect(coachDeckSettings(generation(4))).toBeNull();
    expect(settingsBreak(turn('Fixture Armageddon'), settingsFor(3), deck)).toBe('over-bracket');
  });

  it('bars two-card combos at Bracket 1-2, and at Bracket 3 only the early (Ruthless) ones', () => {
    const match = (bracketTag: string | null, pieces = 2) =>
      ({
        combo: {
          cards: [
            { cardName: 'A', oracleId: 'a' },
            { cardName: 'Mox Opal', oracleId: 'b' },
            { cardName: 'C', oracleId: 'c' },
          ].slice(0, pieces),
          produces: ['Infinite mana'],
          popularity: 900,
          bracketTag,
        },
        missingOracleIds: ['b'],
      }) as unknown as ComboMatch;
    const late = fromComboCompletion(match('S'), 'Mox Opal', 'owned');
    const early = fromComboCompletion(match('R'), 'Mox Opal', 'owned');
    const three = fromComboCompletion(match('R', 3), 'Mox Opal', 'owned');
    expect([late.comboPieces, late.comboEarly, early.comboEarly]).toEqual([2, false, true]);
    expect(settingsBreak(late, b2, deck)).toBe('over-bracket');
    expect(settingsBreak(early, b2, deck)).toBe('over-bracket');
    expect(settingsBreak(late, settingsFor(3), deck)).toBeNull();
    expect(settingsBreak(early, settingsFor(3), deck)).toBe('over-bracket');
    expect(settingsBreak(three, b2, deck)).toBeNull();
    expect(settingsBreak(three, settingsFor(3), deck)).toBeNull();
    expect(coachDeckSettings(generation(4))).toBeNull();
  });

  it('restrains nothing for a deck that states no bracket', () => {
    const s = coachDeckSettings({ generationContext: null, bracketOverride: null });
    expect(s).toBeNull();
  });
});

describe('a Spike deck: interaction and speed first', () => {
  const ctx = (intent?: CoachContext['intent']): CoachContext => ({
    roleCounts: {},
    roleTargets: {},
    deckSize: 90,
    deckTarget: 99,
    bracketOverridePresent: false,
    ownedNames: new Set(),
    intent,
  });
  const add = (name: string, over: Partial<Change>): Change => ({
    id: `fill-gaps:${name}`,
    type: 'add',
    lane: 'fill-gaps',
    name,
    ...over,
  });
  const rows = [
    add('Harmonize', { role: 'cardDraw', inclusion: 70 }),
    add('Swords to Plowshares', { role: 'removal', inclusion: 40 }),
    add('Mox Opal', { role: 'ramp', cmc: 1, inclusion: 30 }),
  ];
  const names = (intent?: CoachContext['intent']) =>
    rankCoachMoves(rows, ctx(intent)).map((m) => m.change.name);

  it('leaves the order alone for a balanced deck', () => {
    expect(names('balanced')[0]).toBe('Harmonize');
    expect(names()[0]).toBe('Harmonize');
  });

  it('leads with removal and speed, before the better-played draw', () => {
    expect(names('spike')).toEqual(['Swords to Plowshares', 'Mox Opal', 'Harmonize']);
  });

  it('sinks a tutor on a casual deck without hiding it', () => {
    const tutors = [
      add('Demonic Tutor', { inclusion: 60 }),
      add('Harmonize', { role: 'cardDraw', inclusion: 30 }),
    ];
    expect(rankCoachMoves(tutors, ctx('balanced'))[0].change.name).toBe('Demonic Tutor');
    expect(rankCoachMoves(tutors, ctx('casual')).map((m) => m.change.name)).toEqual([
      'Harmonize',
      'Demonic Tutor',
    ]);
  });

  it('leads a casual deck with its on-theme move', () => {
    const themed = [
      add('Harmonize', { role: 'cardDraw', inclusion: 70 }),
      add('Blood Artist', { isThemeSynergy: true, inclusion: 20 }),
    ];
    expect(rankCoachMoves(themed, ctx('casual'))[0].change.name).toBe('Blood Artist');
    expect(rankCoachMoves(themed, ctx('balanced'))[0].change.name).toBe('Harmonize');
  });
});
