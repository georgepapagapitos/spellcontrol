import { describe, it, expect } from 'vitest';
import {
  buildCommanderProfile,
  getCombinedOracleText,
  isTribalProfile,
  type CommanderKeyword,
} from './commanderProfile';
import { whyCardMatches } from './whyCardMatches';
import { Archetype } from '@/deck-builder/types';
import type { ScryfallCard } from '@/deck-builder/types';

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id-1',
    oracle_id: 'oracle-1',
    name: 'Test Card',
    cmc: 3,
    type_line: 'Legendary Creature',
    oracle_text: '',
    color_identity: ['W', 'B'],
    keywords: [],
    rarity: 'mythic',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

const keywords = (cmd: ScryfallCard): CommanderKeyword[] =>
  buildCommanderProfile(cmd).abilities.map((a) => a.keyword);

describe('buildCommanderProfile', () => {
  it('detects sacrifice, +1/+1 counters and leaves-the-battlefield (Habby-like)', () => {
    const habby = makeCard({
      name: 'Habby, Bare Spirit',
      type_line: 'Legendary Creature — Bear Spirit',
      oracle_text:
        'Whenever Habby enters or attacks, you may sacrifice another creature or artifact. If you do, put two +1/+1 counters on Habby.\nWhen Habby leaves the battlefield, put its counters on target creature you control.',
    });
    const profile = buildCommanderProfile(habby);
    const kw = profile.abilities.map((a) => a.keyword);

    expect(kw).toContain('etb');
    expect(kw).toContain('attack-trigger');
    expect(kw).toContain('sacrifice');
    expect(kw).toContain('plus-one-counters');
    expect(kw).toContain('leaves-battlefield');
    expect(profile.primaryArchetype).toBe(Archetype.ARISTOCRATS);
    expect(profile.suggestedThemes).toContain('aristocrats');
    expect(profile.suggestedThemes).toContain('+1/+1 counters');
    expect(profile.summary.toLowerCase()).toContain('habby');
  });

  it('reads "whenever a creature you control enters" as creature-etb and credits token makers (E642)', () => {
    const terror = makeCard({
      name: 'Terror of the Peaks',
      type_line: 'Creature — Dragon',
      oracle_text:
        "Flying\nSpells your opponents cast that target this creature cost an additional 3 life to cast.\nWhenever another creature you control enters, this creature deals damage equal to that creature's power to any target.",
    });
    const profile = buildCommanderProfile(terror);
    expect(profile.abilities.map((a) => a.keyword)).toContain('creature-etb');

    const avenger = makeCard({
      name: 'Avenger of Zendikar',
      type_line: 'Creature — Elemental',
      oracle_text:
        'When this creature enters, create a 0/1 green Plant creature token for each land you control.\nLandfall — Whenever a land you control enters, you may put a +1/+1 counter on each Plant creature you control.',
    });
    expect(whyCardMatches(avenger, profile)).toContain('Puts creatures onto the battlefield');

    const witness = makeCard({
      name: 'Eternal Witness',
      type_line: 'Creature — Human Shaman',
      oracle_text:
        'When this creature enters, you may return target card from your graveyard to your hand.',
    });
    expect(whyCardMatches(witness, profile)).not.toContain('Puts creatures onto the battlefield');
  });

  it('does not read a dies trigger that returns a creature as creature-etb (E642)', () => {
    const kw = keywords(
      makeCard({
        name: 'Syr Konrad, the Grim',
        oracle_text:
          'Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, Syr Konrad deals 1 damage to each opponent.',
      })
    );
    expect(kw).not.toContain('creature-etb');
  });

  it('detects the attack-trigger doubler idiom with no when/whenever token (Isshin)', () => {
    const kw = keywords(
      makeCard({
        name: 'Isshin, Two Heavens as One',
        type_line: 'Legendary Creature — Human Samurai',
        oracle_text:
          'If a creature attacking causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.',
      })
    );
    expect(kw).toContain('attack-trigger');
  });

  it('detects the you-control variant of the doubler idiom (Wulfgar of Icewind Dale)', () => {
    const kw = keywords(
      makeCard({
        name: 'Wulfgar of Icewind Dale',
        type_line: 'Legendary Creature — Human Barbarian',
        oracle_text:
          'Melee\nIf a creature you control attacking causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.',
      })
    );
    expect(kw).toContain('attack-trigger');
  });

  it("does NOT match 'causes' and 'attacks' as separate unrelated clauses (exact-phrase guard)", () => {
    const kw = keywords(
      makeCard({
        name: 'Fake Commander',
        type_line: 'Legendary Creature — Human Wizard',
        oracle_text:
          'This creature causes each opponent to lose 1 life during your upkeep. Creatures your opponents control can block only if defending player attacks next turn.',
      })
    );
    expect(kw).not.toContain('attack-trigger');
  });

  it('strips reminder text and neutralizes the card name', () => {
    const text = getCombinedOracleText(
      makeCard({
        name: 'Krenko, Mob Boss',
        oracle_text:
          'Whenever Krenko, Mob Boss attacks, create a token. Krenko gets +1/+1 (this is a counter).',
      })
    );
    expect(text).not.toContain('krenko');
    expect(text).not.toContain('(this is a counter)');
    expect(text).toContain('~');
  });

  it('detects a spellslinger commander', () => {
    const kw = keywords(
      makeCard({
        name: 'Spella, the Caster',
        type_line: 'Legendary Creature — Human Wizard',
        oracle_text: 'Whenever you cast an instant or sorcery spell, draw a card.',
      })
    );
    expect(kw).toContain('spellcast');
    expect(kw).toContain('draw');
  });

  it('detects lifegain + drain and maps to aristocrats archetype', () => {
    const profile = buildCommanderProfile(
      makeCard({
        name: 'Drainer',
        oracle_text: 'Whenever you gain life, each opponent loses that much life.',
      })
    );
    const kw = profile.abilities.map((a) => a.keyword);
    expect(kw).toContain('lifegain');
    expect(kw).toContain('lifeloss-drain');
    expect(profile.primaryArchetype).toBe(Archetype.ARISTOCRATS);
  });

  it('detects tribal from creature subtypes', () => {
    const profile = buildCommanderProfile(
      makeCard({
        name: 'Goblin King',
        type_line: 'Legendary Creature — Goblin Warrior',
        oracle_text: 'Other Goblins you control get +1/+0.',
      })
    );
    expect(profile.tribes).toContain('goblin');
    expect(profile.suggestedThemes).toContain('goblins');
    expect(profile.abilities.some((a) => a.keyword === 'tribal')).toBe(true);
  });

  it("names a tribe's theme the way EDHREC spells it, irregular plurals included (E511)", () => {
    // Real Oracle text and type line.
    const magda = makeCard({
      name: 'Magda, Brazen Outlaw',
      type_line: 'Legendary Creature — Dwarf Berserker',
      oracle_text:
        'Other Dwarves you control get +1/+0.\nWhenever a Dwarf you control becomes tapped, create a Treasure token.\nSacrifice five Treasures: Search your library for an artifact or Dragon card, put that card onto the battlefield, then shuffle.',
    });
    const profile = buildCommanderProfile(magda);
    expect(profile.tribes).toEqual(['dwarf', 'berserker']);
    // Only the type the text is about becomes a theme: Magda never mentions Berserkers.
    expect(profile.suggestedThemes).toContain('dwarves');
    expect(profile.suggestedThemes).not.toContain('berserkers');
    expect(profile.suggestedThemes).not.toContain('dwarfs');
  });

  it('detects voltron from stacked evasion keywords with no engine', () => {
    const profile = buildCommanderProfile(
      makeCard({
        name: 'Sword Lord',
        type_line: 'Legendary Creature',
        oracle_text: '',
        power: '4',
        toughness: '4',
        keywords: ['Trample', 'Double strike'],
      })
    );
    expect(profile.abilities.some((a) => a.keyword === 'voltron')).toBe(true);
    expect(profile.primaryArchetype).toBe(Archetype.VOLTRON);
  });

  it('scales voltron confidence with keyword-hit count so it resists a couple of incidental aggro signals (Atraxa-shaped regression guard)', () => {
    // 4 stacked evasion/protection keywords (Atraxa-shaped: flying, deathtouch,
    // trample, double strike) PLUS an oracle-text clause that fires BOTH
    // 'attack-trigger' (weight 1) and 'extra-combat' (weight 2, default) —
    // total incidental aggro weight = 3. Under the old flat voltron weight of
    // 2, aggro would win outright (3 > 2); the hit-count-scaled weight (4)
    // keeps voltron on top.
    const profile = buildCommanderProfile(
      makeCard({
        name: 'Stacked Praetor',
        type_line: 'Legendary Creature — Angel',
        oracle_text:
          'Whenever Stacked Praetor attacks, it gets an additional combat phase after this one.',
        power: '4',
        toughness: '4',
        keywords: ['Flying', 'Deathtouch', 'Trample', 'Double strike'],
      })
    );
    const kw = profile.abilities.map((a) => a.keyword);
    expect(kw).toContain('attack-trigger');
    expect(kw).toContain('extra-combat');
    expect(kw).toContain('voltron');
    expect(profile.primaryArchetype).toBe(Archetype.VOLTRON);
  });

  it('does not call a vanilla-statted typal commander voltron (Morcant-shaped regression guard)', () => {
    // Zero evasion/protection keywords, power 4, typal ETB trigger. A big body alone
    // was 12% voltron against the commander golden set, so it no longer votes.
    const profile = buildCommanderProfile(
      makeCard({
        name: 'High Perfect Morcant',
        type_line: 'Legendary Creature — Elf Noble',
        oracle_text:
          'Whenever High Perfect Morcant or another Elf you control enters, each opponent blights 1.',
        power: '4',
        toughness: '4',
        keywords: [],
      })
    );
    expect(profile.abilities.some((a) => a.keyword === 'voltron')).toBe(false);
    expect(profile.primaryArchetype).toBe(Archetype.TRIBAL);
  });

  it('calls a creature that buffs itself with equipment or a commander clause voltron', () => {
    // Real Oracle text.
    const danitha = makeCard({
      name: 'Danitha Capashen, Paragon',
      type_line: 'Legendary Creature — Human Knight',
      oracle_text:
        'First strike, vigilance, lifelink\nAura and Equipment spells you cast cost {1} less to cast.',
      power: '2',
      toughness: '2',
      keywords: ['First strike', 'Vigilance', 'Lifelink'],
    });
    expect(keywords(danitha)).toContain('voltron');
  });

  it('does not call a legendary Human tribal when its text never mentions Humans', () => {
    // Real Oracle text.
    const loran = makeCard({
      name: 'Loran of the Third Path',
      type_line: 'Legendary Creature — Human Artificer',
      oracle_text:
        'Vigilance\nWhen Loran enters, destroy up to one target artifact or enchantment.\n{T}: You and target opponent each draw a card.',
      power: '2',
      toughness: '1',
      keywords: ['Vigilance'],
    });
    const profile = buildCommanderProfile(loran);
    expect(profile.tribes).toContain('human');
    expect(profile.abilities.some((a) => a.keyword === 'tribal')).toBe(false);
  });

  it('keeps the 2-keyword-hit voltron weight at the historical baseline of 2', () => {
    const profile = buildCommanderProfile(
      makeCard({
        name: 'Sword Lord',
        type_line: 'Legendary Creature',
        oracle_text: '',
        power: '4',
        toughness: '4',
        keywords: ['Trample', 'Double strike'],
      })
    );
    const voltronAbility = profile.abilities.find((a) => a.keyword === 'voltron');
    expect(voltronAbility?.archWeight).toBe(2);
  });

  it('reads oracle text from every card face (DFC commander)', () => {
    const kw = keywords(
      makeCard({
        name: 'Front // Back',
        oracle_text: undefined,
        card_faces: [
          { name: 'Front', type_line: 'Legendary Creature — Elf', oracle_text: 'Vigilance' },
          {
            name: 'Back',
            type_line: 'Legendary Creature — Elf',
            oracle_text:
              'Whenever Back enters the battlefield, search your library for a creature card.',
          },
        ],
      })
    );
    expect(kw).toContain('etb');
    expect(kw).toContain('tutor');
  });

  it('ranks the primary archetype ahead of incidental signals (Teval)', () => {
    // Teval attacks to mill + recurs lands + makes tokens on graveyard
    // churn. The attack trigger is incidental — this is a reanimator deck,
    // and the preselected themes must lead with that, not "aggro".
    const profile = buildCommanderProfile(
      makeCard({
        name: 'Teval, the Balanced Scale',
        type_line: 'Legendary Creature — Spirit Dragon',
        keywords: ['Flying'],
        oracle_text:
          'Flying\nWhenever Teval attacks, mill three cards. Then you may return a land card from your graveyard to the battlefield tapped.\nWhenever one or more cards leave your graveyard, create a 2/2 black Zombie Druid creature token.',
      })
    );

    expect(profile.primaryArchetype).toBe(Archetype.REANIMATOR);

    const themes = profile.suggestedThemes;
    const firstReanimatorIdx = Math.min(
      ...['reanimator', 'graveyard', 'mill'].map((t) =>
        themes.indexOf(t) === -1 ? Infinity : themes.indexOf(t)
      )
    );
    const firstAggroIdx = Math.min(
      ...['aggro', 'attack triggers', 'combat'].map((t) =>
        themes.indexOf(t) === -1 ? Infinity : themes.indexOf(t)
      )
    );
    expect(firstReanimatorIdx).toBeLessThan(firstAggroIdx);
    // The first listed ability should belong to the detected archetype.
    expect(profile.abilities[0].archetypeHint).toBe(Archetype.REANIMATOR);
  });

  it('surfaces each ability’s primary theme in the top few, not one ability’s whole list', () => {
    // General breadth-first guarantee: a commander with a multi-theme dominant
    // ability (here an ETB → blink/flicker/etb) plus a distinct lower-ranked
    // ability must still float that other ability's PRIMARY theme near the front
    // of suggestedThemes — depth-first flattening buried it below the ETB's
    // secondary themes, skewing every consumer of the list (deck-identity
    // fallback, playstyle index). Queen Marchesa is just a convenient fixture
    // (ETB + token maker + monarch); the property is not monarch-specific.
    const profile = buildCommanderProfile(
      makeCard({
        name: 'Queen Marchesa',
        type_line: 'Legendary Creature — Human Noble',
        oracle_text:
          'Deathtouch, haste\nWhen Queen Marchesa enters the battlefield, you become the monarch.\nAt the beginning of your upkeep, if an opponent is the monarch, create a 1/1 red and white Assassin creature token with deathtouch and haste.',
      })
    );

    const kw = profile.abilities.map((a) => a.keyword);
    expect(kw).toContain('etb');
    expect(kw).toContain('monarch');

    // 'monarch' is the primary theme of a lower-ranked ability; it must lead the
    // list (top 3), not get crowded out by the ETB's blink/flicker cluster.
    expect(profile.suggestedThemes.slice(0, 3)).toContain('monarch');
    // And no near-duplicate cluster: the ETB's own secondary themes shouldn't
    // all precede monarch (that was the depth-first failure).
    expect(profile.suggestedThemes.indexOf('monarch')).toBeLessThan(
      profile.suggestedThemes.indexOf('flicker')
    );
  });

  it('returns a graceful summary for a vanilla commander', () => {
    const profile = buildCommanderProfile(makeCard({ name: 'Plain Bear', oracle_text: '' }));
    expect(profile.abilities).toHaveLength(0);
    expect(profile.primaryArchetype).toBe(Archetype.GOODSTUFF);
    expect(profile.summary).toContain('Plain Bear');
  });
});

describe('whyCardMatches', () => {
  const habby = makeCard({
    name: 'Habby, Bare Spirit',
    oracle_text:
      'Whenever Habby enters or attacks, you may sacrifice another creature or artifact. If you do, put two +1/+1 counters on Habby.\nWhen Habby leaves the battlefield, put its counters on target creature you control.',
  });
  const profile = buildCommanderProfile(habby);

  it('flags a token maker as sac fodder', () => {
    const reasons = whyCardMatches(
      makeCard({
        name: 'Token Maker',
        oracle_text: 'At the beginning of your end step, create a 1/1 white Spirit creature token.',
      }),
      profile
    );
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join(' ').toLowerCase()).toMatch(/sac|token/);
  });

  it('flags a blink spell for ETB / leaves-the-battlefield', () => {
    const reasons = whyCardMatches(
      makeCard({
        name: 'Flicker Spell',
        type_line: 'Instant',
        oracle_text: 'Exile target creature you control, then return it to the battlefield.',
      }),
      profile
    );
    expect(reasons.length).toBeGreaterThan(0);
  });

  it('returns no reasons for an unrelated card', () => {
    const reasons = whyCardMatches(
      makeCard({
        name: 'Unrelated',
        type_line: 'Instant',
        oracle_text: 'Counter target spell.',
      }),
      profile
    );
    expect(reasons).toHaveLength(0);
  });

  it('caps the number of reasons', () => {
    const reasons = whyCardMatches(
      makeCard({
        name: 'Everything',
        oracle_text:
          'When this enters, sacrifice a creature, put a +1/+1 counter on it, create a token, draw a card.',
      }),
      profile,
      2
    );
    expect(reasons.length).toBeLessThanOrEqual(2);
  });
});

describe('isTribalProfile', () => {
  const tribal = { abilities: [{ keyword: 'tribal' }] } as Parameters<typeof isTribalProfile>[0];
  const plain = { abilities: [] } as Parameters<typeof isTribalProfile>[0];

  it('is true for a tribal commander in up to three colors', () => {
    expect(isTribalProfile(tribal, ['W', 'B', 'R'])).toBe(true);
  });

  it('is false past three colors, where the deck needs unrestricted fixing', () => {
    expect(isTribalProfile(tribal, ['W', 'U', 'B', 'R', 'G'])).toBe(false);
  });

  it('is false for a commander that is not tribal', () => {
    expect(isTribalProfile(plain, ['W'])).toBe(false);
  });
});

// Golden R11: voltron needs the commander's text AND the community's agreement.
describe('voltron: the EDHREC theme-share veto', () => {
  const gisela = makeCard({
    name: 'Gisela, Blade of Goldnight',
    type_line: 'Legendary Creature — Angel',
    oracle_text:
      'Flying, first strike\nIf a source would deal damage to an opponent or a permanent an opponent controls, that source deals double that damage instead.',
    keywords: ['Flying', 'First strike'],
  });
  const savanti = makeCard({
    name: "Savanti Romero, Time's Exile",
    type_line: 'Legendary Creature — Demon Wizard',
    oracle_text:
      'Trample\nAt the beginning of combat on your turn, put a +1/+1 counter on Savanti Romero. Then you draw X cards and lose X life, where X is the number of counters on Savanti Romero.',
    keywords: ['Trample'],
  });
  const theme = (name: string, count: number) => ({ name, slug: name.toLowerCase(), count });
  const isVoltron = (c: ScryfallCard, edhrecThemes?: ReturnType<typeof theme>[]) =>
    buildCommanderProfile(c, null, { edhrecThemes }).abilities.some((a) => a.keyword === 'voltron');

  it('fires on text alone when no page was fetched', () => {
    expect(isVoltron(savanti)).toBe(true);
    expect(isVoltron(savanti, [])).toBe(true);
  });

  it('vetoes text that fits when the page has 30+ themed decks and the share is under 4%', () => {
    expect(isVoltron(savanti, [theme('Voltron', 3), theme('Counters', 297)])).toBe(false);
  });

  it('keeps it at 4% and above', () => {
    expect(isVoltron(savanti, [theme('Voltron', 4), theme('Counters', 96)])).toBe(true);
  });

  it('lets the text decide on a thin page (under 30 themed decks)', () => {
    expect(isVoltron(savanti, [theme('Voltron', 0), theme('Counters', 29)])).toBe(true);
  });

  it('ignores zero and missing counts instead of throwing', () => {
    expect(isVoltron(savanti, [theme('Voltron', 0), theme('Counters', Number.NaN)])).toBe(true);
  });

  it('never makes a commander voltron on its own: a 40% share with no text stays false', () => {
    const vanilla = makeCard({ name: 'Bear', type_line: 'Legendary Creature — Bear', power: '2' });
    expect(isVoltron(vanilla, [theme('Voltron', 40), theme('Other', 60)])).toBe(false);
  });

  it('vetoes a keyword body the community does not play as voltron (Gisela, 2%)', () => {
    expect(isVoltron(gisela)).toBe(true);
    expect(isVoltron(gisela, [theme('Voltron', 17), theme('Angels', 831)])).toBe(false);
  });

  it('does not change any other keyword', () => {
    const themes = [theme('Voltron', 1), theme('Counters', 999)];
    const withThemes = buildCommanderProfile(savanti, null, { edhrecThemes: themes });
    const without = buildCommanderProfile(savanti);
    expect(withThemes.abilities.map((a) => a.keyword)).toEqual(
      without.abilities.map((a) => a.keyword).filter((k) => k !== 'voltron')
    );
  });
});

describe('voltron: the text half', () => {
  const creature = (name: string, oracle_text: string, kws: string[] = []) =>
    makeCard({ name, type_line: 'Legendary Creature — Test', oracle_text, keywords: kws });
  const fires = (c: ScryfallCard) => keywords(c).includes('voltron');

  it('counts a counter it puts on itself from its own combat damage or an activation (Zuko, Viv Vision)', () => {
    expect(
      fires(
        creature(
          'Zuko, Seeking Honor',
          'Whenever Zuko deals combat damage to a player, put a +1/+1 counter on him.'
        )
      )
    ).toBe(true);
    expect(
      fires(
        creature(
          'Viv Vision, Teen Synthezoid',
          'Flying\nPower-up — {7}: Put two +1/+1 counters on Viv Vision.'
        )
      )
    ).toBe(true);
  });

  it('does not count growth that waits on other creatures or makes tokens alongside (Namora)', () => {
    expect(
      fires(creature('Grower', 'Whenever another creature enters, put a +1/+1 counter on Grower.'))
    ).toBe(false);
    expect(
      fires(
        creature(
          'Namora, the Sea Queen',
          'Power-up — {5}{U}: Put a +1/+1 counter on Namora. Create two 1/1 blue Merfolk creature tokens.'
        )
      )
    ).toBe(false);
  });

  it('counts "can\'t be blocked by creatures with power 2 or less" as evasion next to a keyword (Questing Beast)', () => {
    const qb = creature(
      'Questing Beast',
      "Vigilance, deathtouch, haste\nQuesting Beast can't be blocked by creatures with power 2 or less.\nCombat damage that would be dealt by creatures you control can't be prevented.\nWhenever Questing Beast deals combat damage to an opponent, it deals that much damage to target planeswalker that player controls.",
      ['Vigilance', 'Haste', 'Deathtouch']
    );
    expect(fires(qb)).toBe(true);
  });

  it('does not count a restriction ("can\'t be blocked by creatures with horsemanship") as evasion (Zuo Ci)', () => {
    const zuoCi = creature(
      'Zuo Ci, the Mocking Sage',
      "Hexproof\nZuo Ci can't be blocked by creatures with horsemanship.",
      ['Hexproof']
    );
    expect(fires(zuoCi)).toBe(false);
  });

  it('reads "~ is equipped" and "attach ... to ~" at the end of a sentence (Cloud, Yuffie)', () => {
    expect(
      fires(
        creature(
          "Cloud, Planet's Champion",
          'During your turn, as long as Cloud is equipped, it has double strike and indestructible.'
        )
      )
    ).toBe(true);
    expect(
      fires(
        creature(
          'Yuffie, Materia Hunter',
          'When Yuffie enters, you may attach an Equipment you control to Yuffie.'
        )
      )
    ).toBe(true);
  });

  it('keeps double strike a body unless it is lent to a whole team (Kratos)', () => {
    expect(fires(creature('Plain Striker', 'Double strike', ['Double strike']))).toBe(true);
    expect(
      fires(
        creature('Kratos, God of War', 'Double strike\nAll creatures have haste.', [
          'Double strike',
        ])
      )
    ).toBe(false);
  });
});
