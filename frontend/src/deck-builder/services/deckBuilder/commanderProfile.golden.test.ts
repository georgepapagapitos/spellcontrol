import { describe, it, expect } from 'vitest';
import { buildCommanderProfile } from './commanderProfile';
import type { ScryfallCard } from '@/deck-builder/types';
import golden from './__fixtures__/commander-profile.golden.fixture.json';
import heldOutGolden from './__fixtures__/commander-profile.heldout.fixture.json';
import keywords4Golden from './__fixtures__/commander-profile.keywords4.fixture.json';

// Guard for the commander side of the profile: which themes and keywords
// buildCommanderProfile claims for a commander. The fixture is 670 real
// commanders (real Oracle text), each tagged with every keyword by two blind
// raters against __fixtures__/commander-profile.golden.md. Before this guard the
// bare-word detectors profiled a vanilla Human as tribal (11% precise), any
// flyer as voltron (12%) and every "you lose 1 life" as a drain (81%).
//
// A ratchet in both directions: a new miss fails, and so does fixing a known
// one until its knownMisses entry is deleted. To change what a keyword means,
// edit the .md and re-rate the affected commanders first.

type Item = { name: string; stratum: 'top' | 'sample' | 'extra'; truth: string[] };
type Fixture = {
  keywords: string[];
  knownMisses: string[];
  cards: Record<string, Omit<ScryfallCard, 'name'>>;
  items: Item[];
  /** "Theme:decks | Theme:decks" per commander, from the commander's EDHREC page. */
  edhrecThemes: Record<string, string>;
};

/** The commander's EDHREC page themes, as buildCommanderProfile takes them (none when the page is missing). */
function themesOf(fx: Fixture, name: string) {
  const raw = fx.edhrecThemes[name];
  if (!raw) return undefined;
  return raw.split(' | ').map((pair) => {
    const at = pair.lastIndexOf(':');
    return { name: pair.slice(0, at), count: Number(pair.slice(at + 1)) };
  });
}
const fixture = golden as unknown as Fixture;

const results = fixture.items.map((item) => {
  const card = { name: item.name, ...fixture.cards[item.name] } as ScryfallCard;
  const fired = new Set<string>(
    buildCommanderProfile(card, null, { edhrecThemes: themesOf(fixture, item.name) }).abilities.map(
      (a) => a.keyword
    )
  );
  return { ...item, fired };
});

const misses = results.flatMap((r) =>
  fixture.keywords.flatMap((k) => {
    const f = r.fired.has(k);
    const t = r.truth.includes(k);
    return f === t ? [] : [`${f ? 'FP' : 'FN'} ${k}: ${r.name}`];
  })
);

/** Micro-averaged over every keyword, on the two unbiased strata. */
function rates(strata: Item['stratum'][]) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const r of results.filter((x) => strata.includes(x.stratum))) {
    for (const k of fixture.keywords) {
      const f = r.fired.has(k);
      const t = r.truth.includes(k);
      if (f && t) tp++;
      else if (f) fp++;
      else if (t) fn++;
    }
  }
  return { precision: tp / (tp + fp), recall: tp / (tp + fn) };
}

describe('commander profile against the golden set', () => {
  it('rates every keyword the profile emits', () => {
    const emitted = new Set(results.flatMap((r) => [...r.fired]));
    for (const k of emitted) expect(fixture.keywords).toContain(k);
  });

  it('misses no commander the golden set does not already list as a known miss', () => {
    const known = new Set(fixture.knownMisses);
    expect(misses.filter((m) => !known.has(m))).toEqual([]);
  });

  it('lists only misses that still happen (delete fixed ones from knownMisses)', () => {
    const now = new Set(misses);
    expect(fixture.knownMisses.filter((m) => !now.has(m))).toEqual([]);
  });

  it('keeps micro precision and recall at their measured floors', () => {
    const { precision, recall } = rates(['top', 'sample']);
    expect(precision).toBeGreaterThanOrEqual(0.88);
    expect(recall).toBeGreaterThanOrEqual(0.88);
  });

  it('keeps the keywords that were worst at their measured floors', () => {
    const rs = results.filter((r) => r.stratum !== 'extra');
    const precision = (k: string) => {
      const tp = rs.filter((r) => r.fired.has(k) && r.truth.includes(k)).length;
      return tp / rs.filter((r) => r.fired.has(k)).length;
    };
    const recall = (k: string) => {
      const tp = rs.filter((r) => r.fired.has(k) && r.truth.includes(k)).length;
      return tp / rs.filter((r) => r.truth.includes(k)).length;
    };
    expect(precision('tribal')).toBeGreaterThanOrEqual(0.85);
    // R11 (2026-10-13) made voltron a text rule AND an EDHREC theme-share veto. Text
    // alone measured P 0.59 / R 0.52 against the re-rated labels; with the page's
    // themes passed in and the text half reading self-growth and written-out evasion,
    // 0.84 / 0.78 on top + sample (4 false positives, 6 misses), so these floors sit
    // a commander or two under that.
    expect(precision('voltron')).toBeGreaterThanOrEqual(0.8);
    expect(recall('voltron')).toBeGreaterThanOrEqual(0.68);
    expect(precision('spellcast')).toBeGreaterThanOrEqual(0.85);
    expect(recall('proliferate')).toBeGreaterThanOrEqual(0.9);
    expect(recall('landfall')).toBeGreaterThanOrEqual(0.9);
    expect(recall('group-hug')).toBeGreaterThanOrEqual(0.85);
  });
});

// The second guard: 90 commanders rated AFTER the detectors were tuned on the
// set above (45 unrated EDHREC-ranked, 45 seeded random, two blind raters), so
// it measures generalization. The creature-etb, leaves-battlefield and
// spellcast fixes below came from its misses.
const heldOut = heldOutGolden as unknown as Fixture;
const heldOutFired = (name: string) =>
  new Set<string>(
    buildCommanderProfile({ name, ...heldOut.cards[name] } as ScryfallCard, null, {
      edhrecThemes: themesOf(heldOut, name),
    }).abilities.map((a) => a.keyword)
  );

describe('commander profile against the held-out set', () => {
  it('misses no commander the held-out set does not already list as a known miss', () => {
    const known = new Set(heldOut.knownMisses);
    const found = heldOut.items.flatMap((item) => {
      const fired = heldOutFired(item.name);
      return heldOut.keywords.flatMap((k) => {
        const f = fired.has(k);
        return f === item.truth.includes(k) ? [] : [`${f ? 'FP' : 'FN'} ${k}: ${item.name}`];
      });
    });
    expect(found.filter((m) => !known.has(m))).toEqual([]);
    expect(heldOut.knownMisses.filter((m) => !found.includes(m))).toEqual([]);
  });

  it.each([
    ['Grumgully, the Generous', 'creature-etb'], // "enters with an additional +1/+1 counter"
    ['Satoru, the Infiltrator', 'creature-etb'], // "Satoru and/or one or more other creatures enter"
    ['Athreos, Shroud-Veiled', 'leaves-battlefield'], // "dies or is put into exile"
    ['God-Eternal Oketra', 'leaves-battlefield'],
    ["Lozhan, Dragons' Legacy", 'spellcast'], // "cast an Adventure or Dragon spell"
  ])('%s is profiled %s', (name, keyword) => {
    expect(heldOutFired(name).has(keyword)).toBe(true);
  });

  it.each([
    ['Questing Beast', 'several evasion and protection abilities, written out and keyword'],
    [
      "Savanti Romero, Time's Exile",
      'puts a counter on itself every combat (25 themed decks, text decides)',
    ],
    [
      'Viv Vision, Teen Synthezoid',
      'counters on itself by a mana-paid activation (21 themed decks)',
    ],
  ])('%s is voltron: %s', (name) => {
    expect(heldOutFired(name).has('voltron')).toBe(true);
  });

  it.each([
    ['Firion, Wild Rose Warrior', 'gear for many creatures, not itself'],
    ['God-Eternal Oketra', 'a token engine with incidental double strike (0.4% Voltron share)'],
  ])('%s is not voltron: %s', (name) => {
    expect(heldOutFired(name).has('voltron')).toBe(false);
  });

  it('does not read an Equipment entering as a creature-enters trigger (Firion)', () => {
    expect(heldOutFired('Firion, Wild Rose Warrior').has('creature-etb')).toBe(false);
  });
});

// The third guard (E1002): creature-etb, enchantment-matters, untap-engine and
// group-hug had 1 to 2 true examples in the held-out set, too few to measure. Every
// commander whose text could touch one of them (851 of 3,441, found by a loose word
// probe) was rated by two blind raters, so the whole candidate population has a label
// and the rest is false by construction. The rules were tuned on `tune`, checked on
// `valid`, and `frozen` was scored once at the end.
type Item4 = { name: string; split: 'tune' | 'valid' | 'frozen'; truth: string[] };
type Fixture4 = {
  keywords: string[];
  knownMisses: string[];
  cards: Record<string, Omit<ScryfallCard, 'name'>>;
  items: Item4[];
};
const fx4 = keywords4Golden as unknown as Fixture4;
const fired4 = (name: string) =>
  new Set<string>(
    buildCommanderProfile({ name, ...fx4.cards[name] } as ScryfallCard).abilities.map(
      (a) => a.keyword
    )
  );
const results4 = fx4.items.map((item) => ({ ...item, fired: fired4(item.name) }));

function rates4(keyword: string, splits: Item4['split'][]) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const r of results4.filter((x) => splits.includes(x.split))) {
    const f = r.fired.has(keyword);
    const t = r.truth.includes(keyword);
    if (f && t) tp++;
    else if (f) fp++;
    else if (t) fn++;
  }
  return { precision: tp / (tp + fp), recall: tp / (tp + fn), truths: tp + fn };
}

describe('commander profile against the four-keyword set', () => {
  const misses = results4.flatMap((r) =>
    fx4.keywords.flatMap((k) =>
      r.fired.has(k) === r.truth.includes(k)
        ? []
        : [`${r.fired.has(k) ? 'FP' : 'FN'} ${k}: ${r.name}`]
    )
  );

  it('misses no commander the set does not already list as a known miss', () => {
    const known = new Set(fx4.knownMisses);
    expect(misses.filter((m) => !known.has(m))).toEqual([]);
  });

  it('lists only misses that still happen (delete fixed ones from knownMisses)', () => {
    const now = new Set(misses);
    expect(fx4.knownMisses.filter((m) => !now.has(m))).toEqual([]);
  });

  it('holds enough true examples of each keyword to measure it', () => {
    for (const k of fx4.keywords) {
      expect(rates4(k, ['tune', 'valid', 'frozen']).truths).toBeGreaterThan(60);
    }
  });

  // Measured on all 851: creature-etb P 1.00 R 0.99, enchantment-matters P 1.00 R 0.90,
  // untap-engine P 0.98 R 0.97, group-hug P 0.94 R 0.93. Floors sit a commander or two under.
  it.each([
    ['creature-etb', 0.95, 0.93],
    ['enchantment-matters', 0.95, 0.85],
    ['untap-engine', 0.93, 0.92],
    ['group-hug', 0.88, 0.87],
  ])('%s keeps precision %f and recall %f over the whole set', (k, p, r) => {
    const got = rates4(k, ['tune', 'valid', 'frozen']);
    expect(got.precision).toBeGreaterThanOrEqual(p);
    expect(got.recall).toBeGreaterThanOrEqual(r);
  });

  // The frozen quarter was scored once, before any rule saw it: creature-etb 1.00 / 0.95,
  // enchantment-matters 1.00 / 0.73, untap-engine 0.94 / 0.88, group-hug 0.86 / 0.86.
  it.each([
    ['creature-etb', 0.9, 0.88],
    ['enchantment-matters', 0.9, 0.65],
    ['untap-engine', 0.85, 0.8],
    ['group-hug', 0.8, 0.78],
  ])('%s keeps precision %f and recall %f on the frozen quarter', (k, p, r) => {
    const got = rates4(k, ['frozen']);
    expect(got.precision).toBeGreaterThanOrEqual(p);
    expect(got.recall).toBeGreaterThanOrEqual(r);
  });

  it.each([
    // creature-etb: the commander's own short name, a type list with a creature type in it,
    // "had enter", counters on creatures as they enter, a doubler that names a type.
    ['Radagast the Brown', 'creature-etb', true],
    ['Kíli the Resourceful', 'creature-etb', true], // "another Dwarf or Equipment you control enters"
    ['Ephara, God of the Polis', 'creature-etb', true], // "had another creature enter"
    ['Gorma, the Gullet', 'creature-etb', true], // "nontoken creatures you control enter with an additional counter"
    ['Naban, Dean of Iteration', 'creature-etb', true], // "a Wizard you control entering causes"
    ['Losheel, Clockwork Scholar', 'creature-etb', true], // "artifact creatures you control enter"
    ['Kolodin, Triumph Caster', 'creature-etb', true], // a Mount is a creature type
    ['Chishiro, the Shattered Blade', 'creature-etb', false], // "an Aura or Equipment you control enters"
    ["Titania, Nature's Force", 'creature-etb', false], // "a Forest you control enters"
    ['Hazezon, Shaper of Sand', 'creature-etb', false], // "a Desert you control enters"
    ['Yarok, the Desecrated', 'creature-etb', false], // "a permanent entering"
    // enchantment-matters
    ['Pharika, God of Affliction', 'enchantment-matters', true], // enchantment creature tokens
    ['Krond the Dawn-Clad', 'enchantment-matters', true], // "if it's enchanted"
    ['Go-Shintai of Ancient Wars', 'enchantment-matters', true], // counts Shrines
    ['Gylwain, Casting Director', 'enchantment-matters', true], // Role tokens
    ['Alela, Artful Provocateur', 'enchantment-matters', true], // "cast an artifact or enchantment spell"
    ['Ramses Overdark', 'enchantment-matters', true], // "destroy target enchanted creature"
    ['Irini Sengir', 'enchantment-matters', false], // taxes enchantment spells
    ['Bartel Runeaxe', 'enchantment-matters', false], // "can't be the target of Aura spells"
    ["Dorothea, Vengeful Victim // Dorothea's Retribution", 'enchantment-matters', false], // Aura back face
    ['Jin-Gitaxias // The Great Synthesis', 'enchantment-matters', false], // "this Saga"
    ['Harold and Bob, First Numens', 'enchantment-matters', false], // becomes an Aura itself
    // untap-engine
    ['Godo, Bandit Warlord', 'untap-engine', true], // "untap it and all Samurai you control"
    ['Living Brain, Mechanical Marvel', 'untap-engine', true], // "target artifact ... . Untap it."
    ['Yasova Dragonclaw', 'untap-engine', true], // gain control, untap that creature
    ["Raiyuu, Storm's Edge", 'untap-engine', true], // another Samurai or Warrior attacks, untap it
    ['Hokori, Dust Drinker', 'untap-engine', true], // "that player untaps a land"
    ['Traxos, Scourge of Kroog', 'untap-engine', false], // "untap step" and "untap ~"
    ['Rubinia Soulsinger', 'untap-engine', false], // "choose not to untap ~ during your untap step"
    ['Lorthos, the Tidemaker', 'untap-engine', false], // "next untap steps" of what it taps
    ['Bruce Banner // The Incredible Hulk', 'untap-engine', false], // "untap him"
    // group-hug
    ['Xira Arien', 'group-hug', true], // "{T}: Target player draws a card"
    ['Seizan, Perverter of Truth', 'group-hug', true], // "that player loses 2 life and draws two cards"
    ['Karazikar, the Eye Tyrant', 'group-hug', true], // "you and the attacking player each draw"
    ['Jolene, the Plunder Queen', 'group-hug', true], // "that attacking player creates a Treasure"
    ['Zedruu the Greathearted', 'group-hug', true], // donates permanents
    ['Casey & Raph, Hotheads', 'group-hug', true], // "each mode must target a different player"
    ['Ms. Bumbleflower', 'group-hug', true], // "target opponent draws a card"
    ['Cait, Cage Brawler', 'group-hug', false], // symmetric loot
    ['Mog, Moogle Warrior', 'group-hug', false], // each player may discard, then draw
    ['Alexios, Deimos of Kosmos', 'group-hug', false], // "that player gains control of ~"
    ['Dack Fayden, Helping Hand', 'group-hug', false], // goaded gifts
    ['Rendmaw, Creaking Nest', 'group-hug', false], // goaded tokens
    ['Aminatou, the Fateshifter', 'group-hug', false], // swaps every permanent
  ])('%s: %s is %s', (name, keyword, expected) => {
    expect(fired4(name).has(keyword)).toBe(expected);
  });
});
