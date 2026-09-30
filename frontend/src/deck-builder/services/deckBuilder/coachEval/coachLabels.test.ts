import { describe, expect, it } from 'vitest';
import { buildNameMatcher, extractDeckLabels, splitClauses, splitSentences } from './coachLabels';

// A real Krenko, Mob Boss critic (gate wnot7s8yp, standard--krenko-mob-boss)
// and real Sivitri differ entries (niche--sivitri-dragon-master-control).
const KRENKO_DECK = [
  'Brash Taunter',
  'Goblin War Strike',
  'Siege-Gang Lieutenant',
  'Volley Veteran',
  'Hobgoblin Bandit Lord',
  'Vandalblast',
  'Goblin Chirurgeon',
  'Impulsive Pilferer',
  'Seething Song',
  'Umbral Mantle',
  'Moggcatcher',
  'Goblin Recruiter',
  'Goblin Matron',
  'Gamble',
  'Skullclamp',
  'The One Ring',
  'Sol Ring',
  'Krenko, Tin Street Kingpin',
  'Mountain',
];
const UNIVERSE = [
  'Chaos Warp',
  'Abrade',
  'Lightning Bolt',
  "Ashnod's Altar",
  'Purphoros, God of the Forge',
  'Purphoros, Bronze-Blooded',
  'Goblin Sharpshooter',
  'Wheel of Fortune',
  'Cavern of Souls',
  'Krenko, Mob Boss',
  'Esika, God of the Tree // The Prismatic Bridge',
  'Snap',
  'Interaction',
];

const FLAWS = [
  "Interaction is thinner than the 13 'removal' count suggests. Brash Taunter, Goblin War Strike (face damage only), Siege-Gang Lieutenant, Volley Veteran and Hobgoblin Bandit Lord are situational pings at best. The only answer to a non-creature threat is Vandalblast: there is no Chaos Warp, Abrade, Lightning Bolt or Reckless Handling-style flexible removal.",
  "Key staples are missing. Ashnod's Altar was flagged as a package pick and still left out, even though it is a core Krenko combo. Purphoros, God of the Forge and Goblin Sharpshooter are also absent.",
  'There are low-impact filler slots: Goblin Chirurgeon, Impulsive Pilferer, Seething Song (net +2 mana is poor in 100-card singleton) and Umbral Mantle.',
  'Real card draw is modest. Goblin Recruiter, Goblin Matron, Moggcatcher and Gamble are tutors, not draw, so the true refuel is Skullclamp, The One Ring and a couple of impulse-draw goblins. A mono-red deck could use Wheel of Fortune.',
  'Moggcatcher is a 4-mana Human, not a Goblin, so it does not trigger the lords.',
];

function krenkoLabels() {
  const commanders = ['Krenko, Mob Boss'];
  return extractDeckLabels({
    deck: 'standard--krenko-mob-boss',
    flaws: FLAWS,
    payoffsLost: [],
    newDeck: KRENKO_DECK,
    baseDeck: KRENKO_DECK,
    commanders,
    matcher: buildNameMatcher([...commanders, ...KRENKO_DECK], UNIVERSE),
  });
}

describe('buildNameMatcher', () => {
  it('matches the longest name at word boundaries, and a DFC by its front face', () => {
    const m = buildNameMatcher([
      'Purphoros, God of the Forge',
      'Esika, God of the Tree // The Prismatic Bridge',
    ]);
    expect(
      m.find('Add Purphoros, God of the Forge and Esika, God of the Tree.').map((x) => x.name)
    ).toEqual(['Purphoros, God of the Forge', 'Esika, God of the Tree // The Prismatic Bridge']);
    expect(m.find('Esikas are not a card').length).toBe(0);
  });

  it('reads a short legendary name only when it names one card', () => {
    const ambiguous = buildNameMatcher(
      [],
      ['Purphoros, God of the Forge', 'Purphoros, Bronze-Blooded']
    );
    expect(ambiguous.find('Purphoros would help.')).toEqual([]);
    // The deck's own Krenko wins over the universe's other one.
    const trusted = buildNameMatcher(['Krenko, Tin Street Kingpin'], ['Krenko, Mob Boss']);
    expect(trusted.find('It still wants Krenko on board.').map((x) => x.name)).toEqual([
      'Krenko, Tin Street Kingpin',
    ]);
  });

  it('skips a one-word universe name that opens a sentence', () => {
    const m = buildNameMatcher([], ['Interaction', 'Snap']);
    expect(m.find('Interaction is thin. It could run Snap.').map((x) => x.name)).toEqual(['Snap']);
  });
});

describe('splitting', () => {
  it('keeps decimals inside a sentence and splits clauses on a turn', () => {
    expect(splitSentences('A 2.58 curve is low. Winter Moon locks its own basics.')).toEqual([
      'A 2.58 curve is low.',
      'Winter Moon locks its own basics.',
    ]);
    expect(splitClauses('X are tutors, not draw, so the true refuel is Skullclamp')).toEqual([
      'X are tutors, not draw',
      'true refuel is Skullclamp',
    ]);
  });
});

describe('extractDeckLabels on a real critic', () => {
  it('reads in-deck cards under a negative cue as weak', () => {
    const { weak } = krenkoLabels();
    for (const name of [
      'Brash Taunter',
      'Goblin War Strike',
      'Goblin Chirurgeon',
      'Seething Song',
      'Umbral Mantle',
      'Moggcatcher',
    ]) {
      expect(weak).toContain(name);
    }
  });

  it('keeps neutral and praised in-deck mentions out of weak', () => {
    const { weak, mentions } = krenkoLabels();
    for (const name of ['Vandalblast', 'Skullclamp', 'The One Ring', 'Goblin Recruiter']) {
      expect(weak).not.toContain(name);
    }
    expect(mentions.find((m) => m.name === 'Skullclamp')?.kind).toBe('context');
  });

  it('reads absent cards as missing, never the commander', () => {
    const { missing } = krenkoLabels();
    expect(missing).toEqual(
      expect.arrayContaining([
        'Chaos Warp',
        'Abrade',
        'Lightning Bolt',
        "Ashnod's Altar",
        'Purphoros, God of the Forge',
        'Goblin Sharpshooter',
        'Wheel of Fortune',
      ])
    );
    expect(missing).not.toContain('Krenko, Mob Boss');
    expect(missing).not.toContain('Krenko, Tin Street Kingpin');
  });
});

describe('extractDeckLabels on differ payoffs', () => {
  it('takes the lost card from the left of the arrow and the replacement from the right', () => {
    const base = ['Junji, the Midnight Sky', 'Hullbreaker Horror', 'Island'];
    const next = ['Snap', 'Astral Cornucopia', 'Island'];
    const labels = extractDeckLabels({
      deck: 'niche--sivitri-dragon-master-control',
      flaws: [],
      payoffsLost: [
        'Junji, the Midnight Sky (67.1% EDHREC inclusion, synergy 200, the highest-inclusion dragon payoff in the pool) -> replaced by Snap (9.6% inclusion, filler bounce).',
        "Hullbreaker Horror (synergy 188, the control deck's combo engine) → replaced by Astral Cornucopia (5.5% inclusion).",
      ],
      newDeck: next,
      baseDeck: base,
      commanders: ['Sivitri, Dragon Master'],
      matcher: buildNameMatcher([...base, ...next]),
    });
    expect(labels.lostPremium).toEqual(['Junji, the Midnight Sky', 'Hullbreaker Horror']);
    expect(labels.replacedBy).toEqual(['Snap', 'Astral Cornucopia']);
  });
});
