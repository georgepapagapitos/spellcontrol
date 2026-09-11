import { describe, it, expect } from 'vitest';
import { detectWinConditions } from './detect';
import type { WinConditionInput } from './detect';
import type { DeckSynergy } from '../synergy/deckSynergy';
import { CORPUS } from '../synergy/classify.fixtures';
import { WINCON_FIXTURES } from './detect.fixtures';

/** Real Scryfall oracle text (synergy corpus or the local fixture file) — never author-written. */
function corpusCard(name: string) {
  const c = CORPUS.find((x) => x.name === name) ?? WINCON_FIXTURES.find((x) => x.name === name);
  if (!c) throw new Error(`fixture missing: ${name}`);
  return { name: c.name, oracle_text: c.oracle_text, type_line: c.type_line, keywords: c.keywords };
}

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

  it('counts a "loses the game" combo as a win path (E77/C2)', () => {
    // Atraxa: Teferi + Chain Veil-style lines report "opponent loses the
    // game", not literal "win the game" — regression for the fix that lets
    // this phrasing qualify instead of falling into 'other' and being
    // invisible to win-path ranking.
    const result = detectWinConditions(
      input({
        combosInDeck: [
          {
            results: ['Each opponent loses the game'],
            cards: ['Teferi, Temporal Archmage', 'The Chain Veil'],
          },
        ],
      })
    );
    expect(result.primary?.category).toBe('infinite-combo');
    expect(result.noClearWinCondition).toBe(false);
  });

  it('counts an "infinite turns" combo as a win path (E77/C2)', () => {
    const result = detectWinConditions(
      input({
        combosInDeck: [{ results: ['Infinite turns'], cards: ['Time Warp', 'Some Untapper'] }],
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

  // E78 item 1 regression: real produces[] shapes from live decks that the
  // narrower regexes previously dropped into 'other' and silently ignored.
  it("counts an infinite card-draw combo (Kozilek: Sensei's Top + Mystic Forge)", () => {
    const result = detectWinConditions(
      input({
        combosInDeck: [
          {
            results: ['Infinite card draw', 'Near-infinite storm count', 'Infinite draw triggers'],
            cards: ["Sensei's Divining Top", 'Foundry Inspector', 'Mystic Forge'],
          },
        ],
      })
    );
    expect(result.primary?.category).toBe('infinite-combo');
    expect(result.primary?.summary).toContain("Sensei's Divining Top");
  });

  it('counts an infinite combat-damage combo (Ur-Dragon: Aggravated Assault)', () => {
    const result = detectWinConditions(
      input({
        combosInDeck: [
          {
            results: ['Infinite combat damage', 'Infinite combat phases', 'Infinite green mana'],
            cards: ['Savage Ventmaw', 'Aggravated Assault'],
          },
        ],
      })
    );
    expect(result.primary?.category).toBe('infinite-combo');
  });

  it('counts an infinite-lifeloss combo (Meren: Mikaeus + Warren Soultrader)', () => {
    const result = detectWinConditions(
      input({
        combosInDeck: [
          {
            results: [
              'Infinite ETB',
              'Infinite LTB',
              'Infinite lifeloss',
              'Infinite lifegain triggers',
            ],
            cards: ['Mikaeus, the Unhallowed', 'Warren Soultrader', 'Bastion of Remembrance'],
          },
        ],
      })
    );
    expect(result.primary?.category).toBe('infinite-combo');
  });
});

describe('infinite creature-token loops', () => {
  it('counts an infinite hasty token combo as a win path (Godo: Dualcaster Mage + Twinflame)', () => {
    // Real Commander Spellbook produces[] labels, as fed by the EDHREC combo page.
    const result = detectWinConditions(
      input({
        combosInDeck: [
          {
            results: [
              'Infinite creature LTB',
              'Infinite creature ETB',
              'Infinite creature tokens with haste',
              'Infinite magecraft triggers',
            ],
            cards: ['Dualcaster Mage', 'Twinflame'],
          },
        ],
      })
    );
    expect(result.primary?.category).toBe('infinite-combo');
    expect(result.primary?.summary).toContain('infinite creature-token loops');
  });

  it('does not treat infinite noncreature tokens as a win path', () => {
    const result = detectWinConditions(
      input({
        combosInDeck: [
          { results: ['Infinite Treasure tokens', 'Infinite colorless mana'], cards: ['A', 'B'] },
        ],
      })
    );
    expect(result.primary?.category).not.toBe('infinite-combo');
  });
});

describe('combo label audit (real Commander Spellbook produces[] labels)', () => {
  const combo = (results: string[]) =>
    detectWinConditions(input({ combosInDeck: [{ results, cards: ['A', 'B'] }] })).primary
      ?.category;

  it('infinite +1/+1 counters and infinitely large creatures are a win path', () => {
    expect(combo(['Infinite +1/+1 counters on a creature'])).toBe('infinite-combo');
    expect(combo(['Infinitely large creature until end of turn'])).toBe('infinite-combo');
    expect(combo(['Near-infinite +1/+1 counters on a creature'])).toBe('infinite-combo');
    expect(combo(['Infinite -1/-1 counters'])).not.toBe('infinite-combo');
    expect(combo(['Infinite charge counters on a permanent'])).not.toBe('infinite-combo');
  });

  it('infinite combat phases are a win path', () => {
    expect(combo(['Infinite combat phases'])).toBe('infinite-combo');
  });

  it("exiling your OWN library is not mill; an opponent's is", () => {
    expect(combo(['Exile your library'])).not.toBe('infinite-combo');
    expect(
      combo(['Exile your library with the ability to play the exiled cards until end of turn'])
    ).not.toBe('infinite-combo');
    expect(combo(["Exile each opponent's library"])).toBe('infinite-combo');
  });

  it('"can\'t lose the game" is not a win', () => {
    expect(combo(["You can't lose the game due to having 0 or less life"])).not.toBe(
      'infinite-combo'
    );
    expect(combo(['Each opponent loses the game'])).toBe('infinite-combo');
  });

  it('tokens given to opponents or that cannot attack are not a board', () => {
    expect(combo(['Infinite creature tokens for target opponent'])).not.toBe('infinite-combo');
    expect(combo(['Infinite creature tokens with 0 power'])).not.toBe('infinite-combo');
    expect(combo(['Infinite tapped creature tokens'])).toBe('infinite-combo');
  });

  it('a veto only applies to its own label, not the whole combo', () => {
    expect(
      combo(['Infinite creature tokens for target opponent', 'Infinite creature tokens'])
    ).toBe('infinite-combo');
  });

  it('bare loops that need a separate payoff stay out', () => {
    for (const l of [
      'Infinite creature ETB',
      'Infinite death triggers',
      'Infinite lifegain',
      'Infinite magecraft triggers',
      'Infinite colorless mana',
      'Lock',
      'Infinite untap of creatures you control',
    ]) {
      expect(combo([l]), l).not.toBe('infinite-combo');
    }
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

describe('go-wide via a token-making commander', () => {
  it('reads a token engine commander fed by an invested axis as the go-wide plan', () => {
    const result = detectWinConditions(
      input({
        commander: corpusCard('Talrand, Sky Summoner'),
        cards: [
          card(
            "Talrand's Invocation",
            'create two 2/2 blue drake creature tokens with flying.',
            'Sorcery'
          ),
          card(
            'Murmuring Mystic',
            'whenever you cast an instant or sorcery spell, create a 1/1 blue bird illusion creature token with flying.',
            'Creature'
          ),
          card('Opt', 'scry 1. draw a card.'),
        ],
        deckSynergy: emptySynergy(['spellslinger']),
      })
    );
    expect(result.primary?.category).toBe('go-wide');
    expect(result.primary?.evidence[0]).toBe('Talrand, Sky Summoner');
    expect(result.primary?.summary).toContain('Talrand, Sky Summoner makes tokens');
    // Command-zone cards are never part of an assembly set.
    for (const opt of result.primary?.assembly ?? []) {
      expect(opt.names).not.toContain('Talrand, Sky Summoner');
    }
  });

  it('does not qualify go-wide off the commander when nothing feeds its trigger', () => {
    const result = detectWinConditions(
      input({
        commander: corpusCard('Talrand, Sky Summoner'),
        cards: [
          card(
            "Talrand's Invocation",
            'create two 2/2 blue drake creature tokens with flying.',
            'Sorcery'
          ),
        ],
      })
    );
    expect(result.primary?.category).not.toBe('go-wide');
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

describe('aristocrats needs a payoff on the raw-count path', () => {
  it('self-sacrificing mana rocks and utility are not an aristocrats plan (Godo)', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card(
            'Lotus Petal',
            '{t}, sacrifice this artifact: add one mana of any color.',
            'Artifact'
          ),
          card('Mind Stone', '{1}, {t}, sacrifice this artifact: draw a card.', 'Artifact'),
          card(
            'Vessel of Volatility',
            '{1}{r}, sacrifice this enchantment: add {r}{r}{r}{r}.',
            'Enchantment'
          ),
          card(
            'Goblin Engineer',
            'sacrifice an artifact: return target artifact card from your graveyard.',
            'Creature'
          ),
          card('Skirk Prospector', 'sacrifice a goblin: add {r}.', 'Creature'),
        ],
      })
    );
    expect([result.primary, ...result.secondary].map((c) => c?.category)).not.toContain(
      'aristocrats'
    );
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

  it('never labels an invested spellslinger deck Burn without burn spells (Talrand)', () => {
    // Regression: the spellslinger axis vouched for Burn on its own, so a
    // Talrand drake list rendered "Burn — 0 direct-damage spells" as primary.
    const result = detectWinConditions(
      input({
        commander: corpusCard('Talrand, Sky Summoner'),
        cards: [
          card('Counterspell', 'counter target spell.'),
          card('Opt', 'scry 1. draw a card.'),
          card('Lightning Bolt', 'deals 3 damage to any target.'),
        ],
        deckSynergy: emptySynergy(['spellslinger']),
      })
    );
    expect(result.primary?.category).not.toBe('burn');
    expect(result.secondary.map((w) => w.category)).not.toContain('burn');
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

describe('burn via permanent damage engines', () => {
  it('counts repeatable damage permanents, commander included (Purphoros)', () => {
    const result = detectWinConditions(
      input({
        commander: corpusCard('Purphoros, God of the Forge'),
        cards: [
          corpusCard('Impact Tremors'),
          corpusCard('Warstorm Surge'),
          corpusCard('Guttersnipe'),
        ],
      })
    );
    expect(result.primary?.category).toBe('burn');
    expect(result.primary?.label).toBe('Burn / damage engines');
    expect(result.primary?.evidence).toContain('Purphoros, God of the Forge');
    expect(result.primary?.summary).toBe('4 damage engines');
    for (const opt of result.primary?.assembly ?? []) {
      expect(opt.names).not.toContain('Purphoros, God of the Forge');
    }
  });

  it('counts pingers and cast triggers alongside burn spells (Niv-Mizzet)', () => {
    const result = detectWinConditions(
      input({
        commander: corpusCard('Niv-Mizzet, Parun'),
        cards: [
          corpusCard('Prodigal Sorcerer'),
          corpusCard('Kessig Flamebreather'),
          card('Lightning Bolt', 'deals 3 damage to any target.'),
        ],
        deckSynergy: emptySynergy(['spellslinger']),
      })
    );
    expect(result.primary?.category).toBe('burn');
    expect(result.primary?.summary).toBe('1 direct-damage spell, 3 damage engines');
  });

  it('ignores one-shot enters/dies damage — not an engine', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card(
            'Fake Kavu',
            'when this creature enters, it deals 4 damage to any target.',
            'Creature'
          ),
          card(
            'Fake Kavu 2',
            'when this creature enters, it deals 4 damage to any target.',
            'Creature'
          ),
          card(
            'Fake Kavu 3',
            'when this creature enters, it deals 4 damage to any target.',
            'Creature'
          ),
          card(
            'Fake Kavu 4',
            'when this creature enters, it deals 4 damage to any target.',
            'Creature'
          ),
        ],
      })
    );
    expect(result.primary?.category).not.toBe('burn');
  });
});

describe('command zone counts as evidence', () => {
  it('poison: a poison commander plus one infect card is a plan (Fynn)', () => {
    const result = detectWinConditions(
      input({
        commander: corpusCard('Fynn, the Fangbearer'),
        cards: [corpusCard('Skithiryx, the Blight Dragon')],
      })
    );
    expect(result.primary?.category).toBe('poison');
    expect(result.primary?.evidence).toContain('Fynn, the Fangbearer');
    for (const opt of result.primary?.assembly ?? []) {
      expect(opt.names).not.toContain('Fynn, the Fangbearer');
    }
  });

  it('mill: a mill-doubler commander clears the floor with three mill cards (Bruvac)', () => {
    const result = detectWinConditions(
      input({
        commander: corpusCard('Bruvac the Grandiloquent'),
        cards: [
          card('Glimpse the Unthinkable', 'target player mills 10 cards.', 'Sorcery'),
          card('Maddening Cacophony', 'each opponent mills eight cards.', 'Instant'),
          card('Mind Funeral', 'target opponent mills cards until four land cards.', 'Sorcery'),
        ],
      })
    );
    expect(result.primary?.category).toBe('mill');
    expect(result.primary?.evidence).toContain('Bruvac the Grandiloquent');
  });

  it('does not double-count a commander the caller already put in cards', () => {
    const fynn = corpusCard('Fynn, the Fangbearer');
    const result = detectWinConditions(
      input({ commander: fynn, cards: [fynn, corpusCard('Skithiryx, the Blight Dragon')] })
    );
    expect(result.primary?.evidence.filter((n) => n === fynn.name)).toHaveLength(1);
  });
});

describe('token engine must be a repeatable trigger', () => {
  it('a dies-trigger token maker is not the go-wide engine (Elenda)', () => {
    const sac = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        card(`Outlet ${i}`, 'sacrifice a creature: draw a card.', 'Creature')
      );
    const result = detectWinConditions(
      input({
        commander: corpusCard('Elenda, the Dusk Rose'),
        cards: sac(4),
        deckSynergy: emptySynergy(['sacrifice']),
      })
    );
    const goWide = [result.primary, ...result.secondary].find((c) => c?.category === 'go-wide');
    expect(goWide?.summary ?? '').not.toContain('makes tokens');
  });

  it('an attack-trigger token maker is the engine when its axis is invested (Adeline)', () => {
    const result = detectWinConditions(
      input({
        commander: corpusCard('Adeline, Resplendent Cathar'),
        cards: [],
        deckSynergy: emptySynergy(['tokens']),
      })
    );
    expect(result.primary?.category).toBe('go-wide');
    expect(result.primary?.summary).toContain('Adeline, Resplendent Cathar makes tokens');
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

  it('calls it go-wide once the deck is committed (≥6 cards — its own, higher bar)', () => {
    // Go-wide's qualifying floor sits above the shared STRATEGIC_MIN_CARDS:
    // token/anthem effects are common incidental value in non-tokens shells
    // (E77 fix — a titan-ramp deck with a couple of unrelated token makers
    // must not get labeled "Go-wide tokens").
    const result = detectWinConditions(
      input({
        cards: [
          card('A', 'create a 1/1 creature token.', 'Creature'),
          card('B', 'create a 1/1 creature token.', 'Creature'),
          card('C', 'create a 1/1 creature token.', 'Creature'),
          card('D', 'create a 1/1 creature token.', 'Creature'),
          card('E', 'create a 1/1 creature token.', 'Creature'),
          card('F', 'creatures you control get +1/+1.', 'Enchantment'),
        ],
      })
    );
    expect(result.primary?.category).toBe('go-wide');
  });

  it('does not call go-wide on 6+ incidental sac-fodder token makers with no payoff (Kozilek titan-ramp)', () => {
    // Eldrazi Spawn/Scion-style bare 0/1 tokens clear the raw-count floor but
    // are sac fodder for ramp, not a go-wide plan — no anthem/payoff present.
    const result = detectWinConditions(
      input({
        cards: [
          card('A', 'create a 0/1 colorless eldrazi spawn creature token.', 'Creature'),
          card('B', 'create a 0/1 colorless eldrazi spawn creature token.', 'Creature'),
          card('C', 'create a 0/1 colorless eldrazi spawn creature token.', 'Creature'),
          card('D', 'create a 1/1 colorless eldrazi scion creature token.', 'Creature'),
          card('E', 'create a 1/1 colorless eldrazi scion creature token.', 'Creature'),
          card('F', 'create a 1/1 colorless eldrazi scion creature token.', 'Creature'),
        ],
      })
    );
    expect(result.primary?.category).not.toBe('go-wide');
  });

  it('does not call go-wide on 5 incidental token cards — below its own bar', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card('A', 'create a 1/1 creature token.', 'Creature'),
          card('B', 'create a 1/1 creature token.', 'Creature'),
          card('C', 'create a 1/1 creature token.', 'Creature'),
          card('D', 'create a 1/1 creature token.', 'Creature'),
          card('E', 'creatures you control get +1/+1.', 'Enchantment'),
        ],
      })
    );
    expect(result.primary?.category).not.toBe('go-wide');
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

// ── Assembly-clock inputs (E75) ──────────────────────────────────────────

describe('assembly', () => {
  it('gives a combo one option per complete combo, needing every piece', () => {
    const result = detectWinConditions(
      input({
        combosInDeck: [
          { results: ['Win the game'], cards: ["Thassa's Oracle", 'Demonic Consultation'] },
          { results: ['Win the game'], cards: ['Laboratory Maniac', 'Tainted Pact'] },
        ],
      })
    );
    expect(result.primary?.assembly).toEqual([
      { names: ["Thassa's Oracle", 'Demonic Consultation'], need: 2 },
      { names: ['Laboratory Maniac', 'Tainted Pact'], need: 2 },
    ]);
  });

  it('excludes the commander and partner from combo assembly sets', () => {
    const result = detectWinConditions(
      input({
        commander: card('Kiki-Jiki, Mirror Breaker'),
        partnerCommander: card('Zealous Conscripts'),
        combosInDeck: [
          {
            results: ['Infinite damage'],
            cards: ['Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts', 'Ashnod’s Altar'],
          },
        ],
      })
    );
    expect(result.primary?.assembly).toEqual([{ names: ['Ashnod’s Altar'], need: 1 }]);
  });

  it('alt-win needs any single finisher', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card('Laboratory Maniac', 'you win the game', 'Creature'),
          card('Approach of the Second Sun', 'you win the game.', 'Sorcery'),
        ],
      })
    );
    expect(result.primary?.category).toBe('alt-win');
    expect(result.primary?.assembly).toEqual([
      { names: ['Laboratory Maniac', 'Approach of the Second Sun'], need: 1 },
    ]);
  });

  it('a strategic plan needs its qualification mass, over the UNCAPPED card list', () => {
    // 10 mill cards — evidence displays only 8, but the assembly pool keeps
    // all 10 (the capped list would wrongly slow the simulated clock).
    const millers = Array.from({ length: 10 }, (_, i) =>
      card(`Miller ${i}`, 'each opponent mills 3 cards.', 'Sorcery')
    );
    const result = detectWinConditions(input({ cards: millers }));
    expect(result.primary?.category).toBe('mill');
    expect(result.primary?.evidence).toHaveLength(8);
    expect(result.primary?.assembly).toEqual([{ names: millers.map((c) => c.name), need: 4 }]);
  });

  it('clamps need to the pool when an invested axis qualified a small list', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card('Mesmeric Orb', 'each opponent mills a card.', 'Artifact'),
          card(
            'Bruvac the Grandiloquent',
            'if an opponent would mill one or more cards, that player mills twice that many instead.',
            'Creature'
          ),
        ],
        deckSynergy: emptySynergy(['mill']),
      })
    );
    expect(result.primary?.category).toBe('mill');
    expect(result.primary?.assembly).toEqual([
      { names: ['Mesmeric Orb', 'Bruvac the Grandiloquent'], need: 2 },
    ]);
  });

  it('voltron needs two pieces of gear', () => {
    const gear = Array.from({ length: 5 }, (_, i) =>
      card(`Blade ${i}`, 'equip {2}. equipped creature gets +2/+2.', 'Artifact — Equipment')
    );
    const result = detectWinConditions(
      input({ commander: card('Rograkh', '', 'Legendary Creature', ['menace']), cards: gear })
    );
    expect(result.primary?.category).toBe('voltron');
    expect(result.primary?.assembly).toEqual([{ names: gear.map((c) => c.name), need: 2 }]);
  });

  it('generic combat carries no assembly', () => {
    const creatures = Array.from({ length: 16 }, (_, i) =>
      card(`Bear ${i}`, '', 'Creature — Bear')
    );
    const result = detectWinConditions(input({ cards: creatures }));
    expect(result.primary?.category).toBe('combat');
    expect(result.primary?.assembly).toBeUndefined();
  });

  it('collects non-land tutors as clock wildcards, even with no win path', () => {
    const result = detectWinConditions(
      input({
        cards: [
          card(
            'Demonic Tutor',
            'Search your library for a card, put that card into your hand, then shuffle.',
            'Sorcery'
          ),
          card(
            'Mystical Tutor',
            'Search your library for an instant or sorcery card, reveal it, then shuffle.',
            'Instant'
          ),
          // Land tutors can't fetch a win-path piece — excluded.
          card(
            'Rampant Growth',
            'Search your library for a basic land card, put that card onto the battlefield tapped.',
            'Sorcery'
          ),
          card(
            'Misty Rainforest',
            'Sacrifice this land: Search your library for a Forest or Island card.',
            'Land'
          ),
        ],
      })
    );
    expect(result.tutors).toEqual(['Demonic Tutor', 'Mystical Tutor']);
    expect(result.noClearWinCondition).toBe(true);
  });
});
