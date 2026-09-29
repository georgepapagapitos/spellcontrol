/**
 * ScryfallCard → ManaCard: everything the simulator needs, read from Oracle
 * text once per card so the game loop never touches a string.
 *
 * Land entry is classified from the wording, not a tag, so a land printed last
 * week reads the same as a staple: shocks ("you may pay 2 life"), check lands,
 * fast and slow lands, tango lands, bond lands, snarls, the legendary-creature
 * condition, and plain taplands. An `unless` clause it does not know reads as
 * tapped. Fetch lands are recognised by a sacrifice-and-search ability with no
 * mana in its cost; they are cracked on entry for the best land still in the
 * library.
 *
 * Ramp is recognised the same way: a nonland permanent with a mana ability (a
 * rock, a dork), a land search that puts lands onto the battlefield (Cultivate,
 * Wood Elves, Sakura-Tribe Elder), or a one-shot Treasure maker.
 */

import type { ScryfallCard } from '@/deck-builder/types';
import { producedManaColors } from '@/lib/deck-analysis/mana-sources';
import type { SimCard } from './opening-hand-sim';
import { maskOf, parseManaCost } from './cost';
import {
  ANY_COLOR,
  type LandEntry,
  type LandFace,
  type LandSearch,
  type ManaCard,
  type ManaChoice,
  type ManaMask,
  type RampEffect,
} from './types';

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};

const TYPE_WORDS: ReadonlyArray<[string, ManaMask]> = [
  ['plains', 1],
  ['island', 2],
  ['swamp', 4],
  ['mountain', 8],
  ['forest', 16],
];

const COLOR_WORDS: Record<string, ManaMask> = { white: 1, blue: 2, black: 4, red: 8, green: 16 };

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function countWord(word: string | undefined): number {
  if (!word) return 1;
  if (/^\d+$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? 0;
}

/** Basic land types named in a phrase, as colour bits. */
function typesIn(phrase: string): ManaMask {
  let m = 0;
  for (const [word, bit] of TYPE_WORDS) if (new RegExp(`\\b${word}\\b`).test(phrase)) m |= bit;
  return m;
}

/** Oracle text lowered, quoted grants removed ("Creatures you control have "{T}: Add …"") and reminder parentheses opened. */
function normalise(text: string | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/"[^"]*"/g, '')
    .replace(/[()]/g, ' ');
}

/** "this land", "this artifact", "it" or the card's own name: the self subject of an entry clause. */
function selfSubject(names: readonly string[]): string {
  const own = names.filter(Boolean).map((n) => escapeRegExp(n.toLowerCase()));
  return `(?:this land|this artifact|this creature|this permanent|it|${own.join('|')})`;
}

/** Generic mana in an activation cost, or -1 when it needs coloured mana. */
function costMana(cost: string): number {
  let generic = 0;
  for (const [, sym] of cost.matchAll(/\{([^}]+)\}/g)) {
    if (sym === 't' || sym === 'q') continue;
    if (/^\d+$/.test(sym)) generic += Number(sym);
    else return -1;
  }
  return generic;
}

interface ManaClause {
  /** Mana produced per activation, net of generic mana in the cost. */
  net: number;
  /** Per-unit masks when the clause names each mana ({C}{C}, {G}{U}); empty = one choice-of unit. */
  symbols: ManaMask[];
  /** Units of "any color" (Gilded Lotus's three). */
  anyCount: number;
  oneShot: boolean;
}

/** The mana abilities of a normalised text that cost {T} and no coloured mana. */
function manaClauses(text: string): ManaClause[] {
  const out: ManaClause[] = [];
  for (const line of text.split('\n')) {
    for (const [, cost, effect] of line.matchAll(/([^:.]*):\s*adds?\s([^.]*)/g)) {
      if (!cost.includes('{t}')) continue;
      const generic = costMana(cost);
      if (generic < 0) continue;
      const oneShot = /sacrifice/.test(cost);
      const any = effect.match(
        /(\w+) mana (?:of any (?:one )?colou?r|in any combination of colou?rs|of the chosen colou?r)/
      );
      if (any) {
        const k = countWord(any[1]);
        out.push({ net: k - generic, symbols: [], anyCount: k, oneShot });
        continue;
      }
      const syms = [...effect.split(' for each')[0].matchAll(/\{([wubrgc])\}/g)].map(([, s]) =>
        maskOf([s])
      );
      if (syms.length === 0) continue;
      // ponytail: a filter ("{W/U}, {T}: Add {W}{W}, {W}{U}, or {U}{U}") is
      // skipped as needing coloured mana, so a filter land reads as its {T}
      // colours: a dual. Model the filter step if a filter-heavy deck misreads.
      const choice = /\bor\b|,/.test(effect);
      const k = choice ? 1 : syms.length;
      out.push({ net: k - generic, symbols: choice ? [] : syms, anyCount: 0, oneShot });
    }
  }
  return out;
}

/**
 * Units a producer makes per activation. `produced` is the single-unit mask.
 * A repeatable ability wins over a sacrifice one (Crystal Vein taps for one
 * {C}; its sacrifice-for-two is not its steady output).
 */
function unitsFrom(clauses: readonly ManaClause[], produced: ManaMask): ManaMask[] {
  let best: ManaClause | null = null;
  for (const c of clauses) {
    if (c.net <= 0) continue;
    if (!best || (best.oneShot && !c.oneShot) || (best.oneShot === c.oneShot && c.net > best.net))
      best = c;
  }
  if (!best) return produced ? [produced] : [];
  if (best.net > 1) {
    // ponytail: "three mana of any one color" becomes three independent
    // any-colour units, so Gilded Lotus can pay {W}{U}{B}. Tie the units to one
    // colour if a deck leans on such a rock for fixing.
    if (best.anyCount > 0) return new Array<ManaMask>(best.net).fill(ANY_COLOR);
    // A {1},{T} rock nets fewer units than it names; keep the named colours.
    return best.symbols.slice(0, best.net);
  }
  return [produced || best.symbols.reduce((m, s) => m | s, 0) || ANY_COLOR];
}

/** A choose-on-entry production (Thriving lands, Coldsteel Heart), or null. */
function choiceIn(text: string, identity: ManaMask): ManaChoice | null {
  const other = text.match(/choose a colou?r other than (white|blue|black|red|green)/);
  if (other) {
    const fixed = COLOR_WORDS[other[1]];
    return { fixed, options: (identity || ANY_COLOR) & ~fixed };
  }
  if (/choose a colou?r\b/.test(text) && /chosen colou?r/.test(text)) {
    return { fixed: 0, options: identity || ANY_COLOR };
  }
  return null;
}

/** Parse a "search your library … put … onto the battlefield" ability, or null. */
export function parseLandSearch(ability: string): LandSearch | null {
  const m = ability.match(
    /search your library for (up to )?(\w+) (.*?) cards?\b(.*?)put (it|them|that card|those cards|one of them|one) onto the battlefield( tapped)?( and the other into your hand)?/
  );
  if (!m) return null;
  const [, , amountWord, phrase, , put, tapped, other] = m;
  if (!/\bland\b/.test(phrase) && typesIn(phrase) === 0) return null;
  const amount = countWord(amountWord);
  const count = put === 'them' || put === 'those cards' ? amount : 1;
  const types = typesIn(phrase);
  const untap = ability.match(/if you control (\w+) or more lands, untap that land/);
  return {
    basicOnly: /\bbasic\b/.test(phrase),
    types: types || ANY_COLOR,
    count,
    toHand: other ? Math.max(0, amount - count) : 0,
    tapped: Boolean(tapped),
    untapAtLands: untap ? countWord(untap[1]) : 0,
  };
}

/** Classify how a land face enters from its normalised text. */
export function parseLandEntry(text: string, names: readonly string[]): LandEntry {
  const self = selfSubject(names);
  if (
    new RegExp(
      `you may pay \\d+ life\\. if you don't, ${self} enters (?:the battlefield )?tapped`
    ).test(text)
  ) {
    return { kind: 'shock' };
  }
  const reveal = text.match(
    new RegExp(
      `you may reveal an? (\\w+) or (\\w+) card from your hand\\. if you don't, ${self} enters`
    )
  );
  const revealTypes = reveal ? typesIn(`${reveal[1]} ${reveal[2]}`) : 0;
  if (revealTypes) return { kind: 'reveal', types: revealTypes };
  // Any other "…. If you don't, it enters tapped" (a tribal reveal land).
  if (new RegExp(`if you don't, ${self} enters (?:the battlefield )?tapped`).test(text)) {
    return { kind: 'conditional' };
  }
  const unless = text.match(
    new RegExp(`${self} enters (?:the battlefield )?tapped unless ([^.]*)`)
  );
  if (unless) {
    const cond = unless[1];
    if (/^you control an? \w+(?: or an? \w+)?$/.test(cond) && typesIn(cond)) {
      return { kind: 'check', types: typesIn(cond) };
    }
    if (/you control two or fewer other lands/.test(cond)) return { kind: 'fast' };
    if (/you control two or more other lands/.test(cond)) return { kind: 'slow' };
    const basics = cond.match(/you control (\w+) or more basic lands/);
    if (basics) return { kind: 'basics', count: countWord(basics[1]) };
    if (/you have two or more opponents/.test(cond)) return { kind: 'bond' };
    if (/you control a legendary creature/.test(cond)) return { kind: 'legendary' };
    return { kind: 'conditional' };
  }
  if (new RegExp(`${self} enters (?:the battlefield )?tapped`).test(text))
    return { kind: 'tapped' };
  return { kind: 'untapped' };
}

interface Face {
  name: string;
  typeLine: string;
  text: string;
  cost: string | undefined;
}

function facesOf(card: ScryfallCard): Face[] {
  if (card.card_faces && card.card_faces.length > 0) {
    return card.card_faces.map((f) => ({
      name: f.name,
      typeLine: f.type_line ?? '',
      text: f.oracle_text ?? '',
      cost: f.mana_cost,
    }));
  }
  return [
    {
      name: card.name,
      typeLine: card.type_line ?? '',
      text: card.oracle_text ?? '',
      cost: card.mana_cost,
    },
  ];
}

const isLandType = (typeLine: string): boolean => /\bland\b/i.test(typeLine.split('—')[0]);

function landFaceOf(
  card: ScryfallCard,
  face: Face,
  identity: ManaMask,
  pathway: Face | null
): LandFace {
  const text = normalise(face.text);
  const names = [face.name, card.name];
  const identitySet = new Set(['W', 'U', 'B', 'R', 'G'].filter((_, i) => identity & (1 << i)));
  const produced = maskOf(
    producedManaColors({ ...card, oracle_text: face.text, type_line: face.typeLine }, identitySet)
  );
  const typeLine = face.typeLine.toLowerCase();
  const fetchAbility = text
    .split('\n')
    .find(
      (l) => /sacrifice[^:]*:\s*search your library/.test(l) && costMana(l.split(':')[0]) === 0
    );
  // ponytail: a fetch whose activation costs mana (a Panorama's {1}, Myriad
  // Landscape's {2}) is not a fetch here, only its own {T} mana. Model the
  // paid crack (tapped land next turn, mana spent) if a deck runs several.
  const fetch = fetchAbility ? parseLandSearch(fetchAbility) : null;
  const minLands = text.match(/activate only if you control (\w+) or more lands/);
  let choice = choiceIn(text, identity);
  if (pathway) {
    const other = maskOf(
      producedManaColors(
        { ...card, oracle_text: pathway.text, type_line: pathway.typeLine },
        identitySet
      )
    );
    const own = maskOf([...text.matchAll(/add \{([wubrgc])\}/g)].map(([, s]) => s));
    choice = { fixed: 0, options: own | other };
  }
  const units = fetch
    ? []
    : choice
      ? [choice.fixed | choice.options]
      : unitsFrom(manaClauses(text), produced);
  return {
    units,
    entry: parseLandEntry(text, names),
    types: typesIn(typeLine.split('—')[1] ?? ''),
    basic: /\bbasic\b/.test(typeLine),
    fetch,
    bounce: /return a land you control to its owner's hand/.test(text),
    minLands: minLands ? countWord(minLands[1]) : 0,
    choice,
  };
}

/** The ramp a nonland face provides when cast, or null. */
function rampOf(card: ScryfallCard, face: Face, identity: ManaMask): RampEffect | null {
  const text = normalise(face.text);
  const typeLine = face.typeLine.toLowerCase();
  const spell = /\b(instant|sorcery)\b/.test(typeLine);
  const self = selfSubject([face.name, card.name]);
  const etb = new RegExp(`^when ${self} enters`);

  for (const line of text.split('\n').map((l) => l.trim())) {
    if (!line.includes('search your library') || /if an opponent/.test(line)) continue;
    const activated = line.match(/^([^:]*):/);
    const eligible =
      spell || etb.test(line) || (activated !== null && costMana(activated[1]) === 0);
    if (!eligible) continue;
    const search = parseLandSearch(line);
    if (search) {
      return {
        kind: 'search',
        search,
        sacrificeLand: /as an additional cost to cast this spell, sacrifice a land/.test(text),
      };
    }
  }

  for (const line of text.split('\n').map((l) => l.trim())) {
    if (!(spell || etb.test(line))) continue;
    const treasure = line.match(/create (a|an|one|two|three|four|five|six|seven) treasure tokens?/);
    if (treasure) return { kind: 'treasure', count: countWord(treasure[1]) };
  }

  if (spell) return null;
  // ponytail: "Spend this mana only to cast…" restrictions are ignored and a
  // Signet is one unit of its two colours (its {1} filter is not modelled).
  // Both read slightly generous; model the restriction if a deck leans on it.
  const clauses = manaClauses(text);
  if (!clauses.some((c) => c.net > 0)) return null;
  const identitySet = new Set(['W', 'U', 'B', 'R', 'G'].filter((_, i) => identity & (1 << i)));
  const produced = maskOf(producedManaColors({ ...card, oracle_text: face.text }, identitySet));
  const choice = choiceIn(text, identity);
  const units = choice ? [choice.fixed | choice.options] : unitsFrom(clauses, produced);
  const creature = /\bcreature\b/.test(typeLine) && !(card.keywords ?? []).includes('Haste');
  const entersTapped = new RegExp(`${self} enters (?:the battlefield )?tapped`).test(text);
  return {
    kind: 'source',
    units,
    delay: creature || entersTapped ? 1 : 0,
    oneShot:
      /doesn't untap during your untap step/.test(text) ||
      clauses.every((c) => c.net <= 0 || c.oneShot),
    choice,
  };
}

export interface ClassifyOptions {
  /**
   * The app's deck role, for the keep rule. Pass the tagger's `getCardRole` to
   * make keep decisions match the deck view exactly; by default a card reads
   * as `ramp` when this classifier found ramp in its text.
   */
  roleOf?: (name: string) => SimCard['role'];
}

/**
 * Reduce a card to what the simulator reads. `identity` (a mask) clamps
 * commander-identity fixers (Command Tower, Arcane Signet) and sets the
 * options of choose-a-colour producers.
 */
export function classifyManaCard(
  card: ScryfallCard,
  identity: ManaMask,
  opts: ClassifyOptions = {}
): ManaCard {
  const faces = facesOf(card);
  const front = faces[0];
  const back = faces[1];
  const landCard = isLandType(front.typeLine);
  const mdfc =
    card.layout === 'modal_dfc' && !landCard && back !== undefined && isLandType(back.typeLine);
  const pathway =
    card.layout === 'modal_dfc' && landCard && back !== undefined && isLandType(back.typeLine)
      ? back
      : null;
  const land = landCard
    ? landFaceOf(card, front, identity, pathway)
    : mdfc
      ? landFaceOf(card, back, identity, null)
      : null;
  const cost = landCard ? null : parseManaCost(front.cost);
  const ramp = landCard ? null : rampOf(card, front, identity);
  const typeForKeep = (card.type_line ?? front.typeLine).toLowerCase();
  const role = opts.roleOf ? opts.roleOf(card.name) : ramp ? 'ramp' : null;
  return {
    name: card.name,
    landCard,
    land,
    mdfc,
    cost,
    ramp,
    legendaryCreature:
      /\blegendary\b/i.test(front.typeLine) && /\bcreature\b/i.test(front.typeLine),
    sim: {
      // Mirrors hand-classify's isLand/cardCmc so the keep rule sees the
      // same hand the deck view's test-hand panel does.
      isLand: typeForKeep.includes('land'),
      cmc: card.cmc ?? 0,
      role,
      colors: card.color_identity ?? [],
    },
  };
}
