import { describe, it, expect } from 'vitest';
import { detectWinConditions } from './detect';
import type { WinConditionInput } from './detect';
import type { DeckSynergy } from '../synergy/deckSynergy';

function emptySynergy(invested: string[] = []): DeckSynergy {
  return {
    axes: [],
    invested: invested as never,
    warnings: [],
    headline: '',
  };
}

function card(name: string, oracle_text = '', type_line = 'Instant', keywords: string[] = []) {
  return { name, oracle_text, type_line, keywords };
}

function input(overrides: Partial<WinConditionInput> = {}): WinConditionInput {
  return {
    cards: [],
    commander: null,
    combosInDeck: [],
    deckSynergy: emptySynergy(),
    format: 'commander',
    ...overrides,
  };
}

// ── Infinite combo ─────────────────────────────────────────────────────────

describe('infinite combo', () => {
  it('detects a win-the-game combo', () => {
    const result = detectWinConditions(
      input({
        combosInDeck: [
          {
            results: ['Win the game', 'Infinite tokens'],
            cards: ["Thassa's Oracle", 'Demonic Consultation'],
          },
        ],
      })
    );
    expect(result.primary?.category).toBe('infinite-combo');
    expect(result.primary?.evidence).toContain("Thassa's Oracle");
    expect(result.noClearWinCondition).toBe(false);
  });

  it('detects an infinite damage combo', () => {
    const result = detectWinConditions(
      input({
        combosInDeck: [
          {
            results: ['Infinite damage'],
            cards: ['Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts'],
          },
        ],
      })
    );
    expect(result.primary?.category).toBe('infinite-combo');
  });

  it('detects an infinite mill combo', () => {
    const result = detectWinConditions(
      input({
        combosInDeck: [
          { results: ['Infinite mill'], cards: ['Mindcrank', 'Bloodchief Ascension'] },
        ],
      })
    );
    expect(result.primary?.category).toBe('infinite-combo');
  });

  it('ignores infinite-mana-only combos for win-con ranking but does not crash', () => {
    const result = detectWinConditions(
      input({
        combosInDeck: [
          { results: ['Infinite mana'], cards: ['Basalt Monolith', 'Rings of Brighthearth'] },
        ],
      })
    );
    // An infinite-mana-only combo is not a win-con by itself
    expect(result.primary?.category).not.toBe('infinite-combo');
  });
});

// ── Alt-win ────────────────────────────────────────────────────────────────

describe('alt-win', () => {
  it('detects "you win the game" oracle text', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card(
            "Thassa's Oracle",
            "when thassa's oracle enters, look at the top x cards of your library, where x is your devotion to blue. put any number of them on the bottom of your library in any order. if your devotion to blue is greater than or equal to the number of cards in your library, you win the game."
          ),
          card('Plains', '', 'Basic Land'),
        ],
      })
    );
    expect(result.primary?.category).toBe('alt-win');
  });

  it('detects "each opponent loses the game"', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card(
            'Approach of the Second Sun',
            'if approach of the second sun was cast from your hand and you cast it this turn, you win the game.'
          ),
        ],
      })
    );
    expect(result.primary?.category).toBe('alt-win');
  });

  it('forces Lab Maniac in via override', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card(
            'Laboratory Maniac',
            'if you would draw a card while your library has no cards, you win instead.'
          ),
        ],
      })
    );
    expect(result.primary?.category).toBe('alt-win');
  });

  it('excludes Platinum Angel override', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card('Platinum Angel', "you can't lose the game and your opponents can't win the game."),
        ],
      })
    );
    // Platinum Angel excluded; only the fallback combat check could apply
    expect(result.primary?.category).not.toBe('alt-win');
  });
});

// ── Mill ───────────────────────────────────────────────────────────────────

describe('mill', () => {
  it('detects opponent mill cards', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card('Glimpse the Unthinkable', 'target player mills 10 cards.', 'Sorcery'),
          card(
            'Bruvac the Grandiloquent',
            'if an opponent would mill one or more cards, that player mills twice that many instead.',
            'Legendary Creature'
          ),
          card('Maddening Cacophony', 'each opponent mills eight cards.', 'Instant'),
        ],
        deckSynergy: emptySynergy(['mill']),
      })
    );
    expect(result.primary?.category).toBe('mill');
    expect(result.primary?.evidence).toContain('Glimpse the Unthinkable');
  });

  it('does not trigger on only self-mill', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card(
            "Stitcher's Supplier",
            "when stitcher's supplier enters or dies, mill three cards.",
            'Creature'
          ),
        ],
      })
    );
    expect(result.primary?.category).not.toBe('mill');
  });
});

// ── Poison ────────────────────────────────────────────────────────────────

describe('poison', () => {
  it('detects infect keyword', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card('Blightsteel Colossus', '', 'Artifact Creature', ['Infect', 'Trample']),
          card('Phyrexian Crusader', '', 'Creature', ['Infect', 'First strike']),
          card('Glistener Elf', '', 'Creature', ['Infect']),
        ],
        deckSynergy: emptySynergy(['poison']),
      })
    );
    expect(result.primary?.category).toBe('poison');
  });

  it('detects toxic keyword', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card('Venerated Rotpriest', '', 'Creature', ['Toxic 1']),
          card('Jawbone Duelist', '', 'Creature', ['Toxic 1']),
          card('Bloated Contaminator', '', 'Creature', ['Trample', 'Toxic 1']),
        ],
      })
    );
    expect(result.primary?.category).toBe('poison');
  });
});

// ── Go-wide tokens ───────────────────────────────────────────────────────

describe('go-wide tokens', () => {
  it('detects token creators with anthems', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card(
            'Rhys the Redeemed',
            'create a 1/1 white and green elf warrior creature token.',
            'Legendary Creature'
          ),
          card(
            'Avenger of Zendikar',
            'when avenger of zendikar enters, create a 0/1 green plant creature token for each land you control.',
            'Creature'
          ),
          card(
            'Craterhoof Behemoth',
            'creatures you control get +x/+x and gain trample.',
            'Creature'
          ),
        ],
        deckSynergy: emptySynergy(['tokens']),
      })
    );
    expect(result.primary?.category).toBe('go-wide');
    expect(result.primary?.evidence).toContain('Rhys the Redeemed');
  });
});

// ── Aristocrats ───────────────────────────────────────────────────────────

describe('aristocrats', () => {
  it('detects sac outlets + payoffs', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card('Viscera Seer', 'sacrifice a creature: scry 1.', 'Creature'),
          card(
            'Blood Artist',
            'whenever blood artist or another creature dies, target player loses 1 life and you gain 1 life.',
            'Creature'
          ),
          card(
            'Zulaport Cutthroat',
            'whenever another creature you control dies, each opponent loses 1 life and you gain 1 life.',
            'Creature'
          ),
          card(
            'Elas il-Kor, Sadistic Pilgrim',
            'whenever another creature enters under your control, each opponent loses 1 life.',
            'Creature'
          ),
          card(
            'Altar of Dementia',
            "sacrifice a creature: target player mills cards equal to that creature's power.",
            'Artifact'
          ),
        ],
        deckSynergy: emptySynergy(['sacrifice']),
      })
    );
    expect(result.primary?.category).toBe('aristocrats');
  });
});

// ── Burn ──────────────────────────────────────────────────────────────────

describe('burn', () => {
  it('detects burn spells targeting players, including X-spell finishers', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card('Lightning Bolt', 'deals 3 damage to any target.', 'Instant'),
          card('Comet Storm', 'deals x damage to each opponent.', 'Instant'),
          card('Fireball', 'fireball deals x damage to any target. ...', 'Sorcery'),
        ],
        deckSynergy: emptySynergy(['spellslinger']),
      })
    );
    expect(result.primary?.category).toBe('burn');
    // X-spell finishers are the bulk of the archetype — they must be detected,
    // not just the fixed-damage Bolt.
    expect(result.primary?.evidence).toContain('Comet Storm');
    expect(result.primary?.evidence).toContain('Fireball');
  });

  it('qualifies an uninvested burn deck once it runs enough spells', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card('Lightning Bolt', 'deals 3 damage to any target.', 'Instant'),
          card('Lava Spike', 'deals 3 damage to target player.', 'Sorcery'),
          card('Comet Storm', 'deals x damage to each opponent.', 'Instant'),
          card('Fireball', 'fireball deals x damage to any target.', 'Sorcery'),
        ],
        // No invested spellslinger axis — qualifies purely on raw count (≥4).
      })
    );
    expect(result.primary?.category).toBe('burn');
  });

  it('does not flag a couple of incidental burn spells as the win-con', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card('Lightning Bolt', 'deals 3 damage to any target.', 'Instant'),
          card('Comet Storm', 'deals x damage to each opponent.', 'Instant'),
        ],
        // 2 burn spells, not invested → below the strategic floor.
      })
    );
    expect(result.primary?.category).not.toBe('burn');
  });
});

// ── X-spell drain ────────────────────────────────────────────────────────────

describe('aristocrats — X drain finishers', () => {
  it('counts Exsanguinate-style X drain as a drain effect', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card(
            'Exsanguinate',
            'each opponent loses x life. you gain life equal to the life lost this way.',
            'Sorcery'
          ),
          card(
            'Torment of Hailfire',
            'repeat the following process x times. ... each opponent loses 3 life.',
            'Sorcery'
          ),
          card('Viscera Seer', 'sacrifice a creature: scry 1.', 'Creature'),
          card(
            'Zulaport Cutthroat',
            'whenever another creature you control dies, each opponent loses 1 life and you gain 1 life.',
            'Creature'
          ),
        ],
      })
    );
    expect(result.primary?.category).toBe('aristocrats');
    expect(result.primary?.label).toBe('Aristocrats / drain');
    expect(result.primary?.evidence).toContain('Exsanguinate');
  });
});

// ── Voltron ───────────────────────────────────────────────────────────────

describe('voltron / commander damage', () => {
  it('detects equipment-heavy deck with evasive commander', () => {
    const cmdr = {
      name: 'Rograkh, Son of Rohgahh',
      type_line: 'Legendary Creature',
      power: '0',
      keywords: ['Double strike', 'Menace', 'Trample'],
    };
    const result = detectWinConditions(
      input({
        cards: [
          card(
            'Colossus Hammer',
            'equip {8}. equipped creature gets +10/+10 and loses flying.',
            'Artifact Equipment'
          ),
          card(
            "Umezawa's Jitte",
            'equip {2}. whenever equipped creature deals combat damage, put two charge counters on jitte.',
            'Artifact Equipment'
          ),
          card(
            'Swiftfoot Boots',
            'equip {1}. equipped creature gains hexproof and haste.',
            'Artifact Equipment'
          ),
          card(
            'Lightning Greaves',
            'equip {0}. equipped creature has shroud and haste.',
            'Artifact Equipment'
          ),
        ],
        commander: cmdr,
        deckSynergy: emptySynergy(['equipment']),
        format: 'commander',
      })
    );
    expect(result.primary?.category).toBe('voltron');
  });

  it('does not apply voltron detection in non-commander formats', () => {
    const cmdr = {
      name: 'Rograkh, Son of Rohgahh',
      type_line: 'Legendary Creature',
      power: '5',
      keywords: ['Flying', 'Double strike'],
    };
    const result = detectWinConditions(
      input({
        cards: [
          card('Colossus Hammer', 'equip {8}.', 'Artifact Equipment'),
          card("Umezawa's Jitte", 'equip {2}.', 'Artifact Equipment'),
          card('Swiftfoot Boots', 'equip {1}.', 'Artifact Equipment'),
        ],
        commander: cmdr,
        deckSynergy: emptySynergy(['equipment']),
        format: 'modern',
      })
    );
    expect(result.primary?.category).not.toBe('voltron');
  });

  it('does NOT call a big evasive commander with zero gear "voltron"', () => {
    // A 7-power double-strike flyer with no equipment/auras must not produce a
    // voltron win-con with empty evidence ("0 equipment — commander has evasion").
    const cmdr = {
      name: 'Big Evasive Commander',
      type_line: 'Legendary Creature',
      power: '7',
      keywords: ['Flying', 'Double strike', 'Trample'],
    };
    const result = detectWinConditions(
      input({
        commander: cmdr,
        cards: [
          card('Sol Ring', 'add {c}{c}.', 'Artifact'),
          card('Arcane Signet', 'add one mana.', 'Artifact'),
        ],
        format: 'commander',
      })
    );
    expect(result.primary?.category).not.toBe('voltron');
  });
});

// ── No clear win condition ────────────────────────────────────────────────

describe('no clear win condition', () => {
  it('returns noClearWinCondition for an empty deck', () => {
    const result = detectWinConditions(input());
    expect(result.noClearWinCondition).toBe(true);
    expect(result.primary).toBeNull();
  });

  it('returns noClearWinCondition for a small pile with no win paths', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card('Forest', '', 'Basic Land'),
          card('Plains', '', 'Basic Land'),
          card('Mountain', '', 'Basic Land'),
        ],
      })
    );
    expect(result.noClearWinCondition).toBe(true);
  });

  it('fires for an unfocused goodstuff pile with only incidental cards', () => {
    // A couple of incidental token makers + one sac outlet — none committed
    // enough to be a real plan, and too few creatures for the combat fallback.
    const result = detectWinConditions(
      input({
        cards: [
          card('Tireless Provisioner', 'landfall — create a treasure or food token.', 'Creature'),
          card('Spectral Sailor', 'flash. {3}{u}: draw a card.', 'Creature'),
          card('Viscera Seer', 'sacrifice a creature: scry 1.', 'Creature'),
          card('Sol Ring', 'add {c}{c}.', 'Artifact'),
        ],
      })
    );
    expect(result.noClearWinCondition).toBe(true);
  });
});

// ── Strategic-commitment gate ─────────────────────────────────────────────────

describe('strategic-commitment gate', () => {
  it('does not call two incidental token makers a go-wide deck', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card('Tireless Provisioner', 'create a 1/1 ... creature token.', 'Creature'),
          card('Hydra Broodmaster', 'create x x/x green hydra creature tokens.', 'Creature'),
        ],
        // 2 token makers, tokens NOT invested → below the strategic floor.
      })
    );
    expect(result.primary?.category).not.toBe('go-wide');
  });

  it('calls it go-wide once the deck is committed (≥4 cards)', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card('A', 'create a 1/1 creature token.', 'Creature'),
          card('B', 'create a 1/1 creature token.', 'Creature'),
          card('C', 'create a 1/1 creature token.', 'Creature'),
          card('D', 'creatures you control get +1/+1.', 'Enchantment'),
        ],
      })
    );
    expect(result.primary?.category).toBe('go-wide');
  });
});

// ── Generic combat fallback ──────────────────────────────────────────────────

describe('generic combat fallback', () => {
  it('reads a creature-dense deck with no specific plan as combat', () => {
    const cards = Array.from({ length: 16 }, (_, i) =>
      card(`Beater ${i}`, 'vanilla beater.', 'Creature')
    );
    const result = detectWinConditions(input({ cards }));
    expect(result.primary?.category).toBe('combat');
  });

  it('does not fall back to combat for a thin creature base', () => {
    const cards = Array.from({ length: 8 }, (_, i) =>
      card(`Beater ${i}`, 'vanilla beater.', 'Creature')
    );
    const result = detectWinConditions(input({ cards }));
    expect(result.noClearWinCondition).toBe(true);
  });
});

// ── Ranking: primary vs secondary ────────────────────────────────────────

describe('ranking', () => {
  it('ranks combo above other paths', () => {
    const result = detectWinConditions(
      input({
        combosInDeck: [
          { results: ['Win the game'], cards: ["Thassa's Oracle", 'Demonic Consultation'] },
          { results: ['Win the game'], cards: ['Laboratory Maniac', 'Tainted Pact'] },
        ],
        cards: [
          card('Glimpse the Unthinkable', 'target player mills 10 cards.', 'Sorcery'),
          card(
            'Mind Funeral',
            'target player mills cards until they have milled four lands.',
            'Sorcery'
          ),
          card('Fractured Sanity', 'each opponent mills 14 cards.', 'Sorcery'),
          card(
            'Bruvac the Grandiloquent',
            'if an opponent would mill one or more cards, that player mills twice that many instead.',
            'Legendary Creature'
          ),
        ],
        deckSynergy: emptySynergy(['mill']),
      })
    );
    expect(result.primary?.category).toBe('infinite-combo');
    expect(result.secondary.some((s) => s.category === 'mill')).toBe(true);
  });
});
