// Test helpers over objective.fixture.json (real Scryfall records, Meren of
// Clan Nel Toth's real EDHREC page and lift pools, the E510 Meren pair; the
// JSON's _source says where each piece came from). Tests only.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DetectedCombo, LiftEntry, Pacing, ScryfallCard } from '@/deck-builder/types';
import {
  createObjectiveContext,
  type EdhrecRow,
  type ObjectiveContextInput,
  type ObjectiveDeck,
  type ObjectiveRole,
} from '../index';

interface Fixture {
  cards: ScryfallCard[];
  merenPage: Record<string, EdhrecRow>;
  globalRank: Record<string, number>;
  lift: Record<string, LiftEntry[]>;
  meren: {
    commander: string;
    colorIdentity: string[];
    roleTargets: Record<ObjectiveRole, number>;
    pacing: Pacing;
    baseline: string[];
    treatment: string[];
    combos: DetectedCombo[];
  };
  hermitDruidCombo: DetectedCombo;
}

const here = dirname(fileURLToPath(import.meta.url));
export const FIX = JSON.parse(
  readFileSync(resolve(here, 'objective.fixture.json'), 'utf8')
) as Fixture;
// Cards the Meren fixture lacks (round2/round3.fixture.json: E513's second and third gates).
const EXTRA = JSON.parse(readFileSync(resolve(here, 'round2.fixture.json'), 'utf8')) as {
  cards: ScryfallCard[];
};
const EXTRA3 = JSON.parse(readFileSync(resolve(here, 'round3.fixture.json'), 'utf8')) as {
  cards: ScryfallCard[];
};
// Yuriko's real page and cards (E513's final gate: Satoru Umezawa, Reanimate).
export const YURIKO = JSON.parse(readFileSync(resolve(here, 'yuriko.fixture.json'), 'utf8')) as {
  cards: ScryfallCard[];
  page: Record<string, EdhrecRow>;
  combos: DetectedCombo[];
};
const CARDS = new Map(
  [...FIX.cards, ...EXTRA.cards, ...EXTRA3.cards, ...YURIKO.cards].map((c) => [c.name, c])
);

/** A fresh copy of a real fixture card. */
export function card(name: string): ScryfallCard {
  const c = CARDS.get(name);
  if (!c) throw new Error(`no fixture card named ${name}`);
  return structuredClone(c);
}
export const cards = (...names: string[]) => names.map(card);

export const MEREN = card('Meren of Clan Nel Toth');
export const merenDeck = (names: readonly string[]): ObjectiveDeck => ({
  commanders: [MEREN],
  cards: names.map(card),
});
export const BASELINE = merenDeck(FIX.meren.baseline);
export const TREATMENT = merenDeck(FIX.meren.treatment);

/** Meren's real page, targets, combos and lift pools; 1,000 goldfish games. */
export function merenCtx(over: Partial<ObjectiveContextInput> = {}) {
  return createObjectiveContext({
    colorIdentity: FIX.meren.colorIdentity,
    customization: { deckFormat: 99, currency: 'USD' },
    edhrec: new Map(Object.entries(FIX.merenPage)),
    globalRank: new Map(Object.entries(FIX.globalRank)),
    roleTargets: FIX.meren.roleTargets,
    pacing: FIX.meren.pacing,
    combos: FIX.meren.combos,
    liftPools: new Map(Object.entries(FIX.lift)),
    manaSim: { games: 1000 },
    ...over,
  });
}

/** Replace one card of a deck (by name) with another, in its slot. */
export function swap(deck: ObjectiveDeck, out: string, inn: string): ObjectiveDeck {
  const i = deck.cards.findIndex((c) => c.name === out);
  if (i < 0) throw new Error(`${out} is not in the deck`);
  const next = [...deck.cards];
  next[i] = card(inn);
  return { commanders: deck.commanders, cards: next };
}
