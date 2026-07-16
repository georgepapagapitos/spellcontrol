/**
 * Pure deck-comparison engine (T22). Diffs two saved decks into card-list,
 * stat, price and bracket deltas — the decision-independent core behind the
 * `/decks/compare` view. No React, no CSS, no I/O: every export is a pure
 * function of its inputs so it's fully unit-testable and reusable on either
 * side of the UI.
 *
 * Conventions reused from the rest of the app:
 *  - Card identity is the printing-agnostic `oracle_id` (fallback `name` for
 *    rows saved before oracle ids existed) — same key the combo/match code uses.
 *  - Stat deltas run the existing `analyzeDeck` engine per deck and subtract;
 *    we never re-derive curve/type/role logic here.
 *  - Bracket comes off the persisted `effectiveBracket` (override-wins) — it's
 *    EDHREC-backed/async and already kept live on the deck record, so we read,
 *    never recompute.
 *  - Price reads the card's own Scryfall `prices` snapshot (usd → foil →
 *    etched), exactly like DeckDisplay. ponytail: snapshot, not the device-local
 *    `card-prices` cache — keeps this module pure; the UI can pre-merge fresher
 *    prices onto the cards before diffing if it ever needs to.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { type Deck, effectiveBracket } from '@/store/decks';
import {
  analyzeDeck,
  type CurveBucket,
  type DeckAnalysisResult,
  type RoleHealth,
  type TypeBreakdown,
} from '@/lib/deck-analysis';

/** Printing-agnostic identity for grouping copies of the same card. */
export const cardKey = (card: ScryfallCard): string => card.oracle_id || card.name;

/**
 * Price for a single copy from its own Scryfall snapshot, in the given
 * currency; 0 when unpriced. Same missing-price semantics as DeckDisplay's
 * priceOf: a card with no EUR price contributes 0 under EUR — no cross-currency
 * fallback, a total never mixes $ and € amounts.
 */
export function cardPrice(card: ScryfallCard, currency: 'USD' | 'EUR' = 'USD'): number {
  const p = card.prices;
  const raw =
    currency === 'EUR' ? (p?.eur ?? p?.eur_foil) : (p?.usd ?? p?.usd_foil ?? p?.usd_etched);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Back-compat alias: the USD pick. */
export function cardUsd(card: ScryfallCard): number {
  return cardPrice(card, 'USD');
}

/** A card present in a deck, with how many copies and whether it's a commander. */
interface CardCount {
  card: ScryfallCard;
  qty: number;
  isCommander: boolean;
}

/** Every card in a deck (commanders + mainboard) folded into per-identity counts. */
function countCards(deck: Deck): Map<string, CardCount> {
  const counts = new Map<string, CardCount>();
  const add = (card: ScryfallCard, isCommander: boolean) => {
    const key = cardKey(card);
    const existing = counts.get(key);
    if (existing) existing.qty += 1;
    else counts.set(key, { card, qty: 1, isCommander });
  };
  for (const c of [deck.commander, deck.partnerCommander]) if (c) add(c, true);
  for (const slot of deck.cards) add(slot.card, false);
  return counts;
}

export interface CardDelta {
  card: ScryfallCard;
  isCommander: boolean;
  /** Copies in deck A (0 when added). */
  fromQty: number;
  /** Copies in deck B (0 when removed). */
  toQty: number;
}

export interface CardListDiff {
  /** In B but not A. */
  added: CardDelta[];
  /** In A but not B. */
  removed: CardDelta[];
  /** In both, different copy counts. */
  changed: CardDelta[];
  /** Number of identities present in both at the same count. */
  unchangedCount: number;
}

/**
 * Card-list delta A → B, keyed by {@link cardKey}. Added/removed/changed are
 * sorted by name so the table order is stable.
 */
export function diffDeckCards(a: Deck, b: Deck): CardListDiff {
  const ca = countCards(a);
  const cb = countCards(b);
  const added: CardDelta[] = [];
  const removed: CardDelta[] = [];
  const changed: CardDelta[] = [];
  let unchangedCount = 0;

  const keys = new Set([...ca.keys(), ...cb.keys()]);
  for (const key of keys) {
    const inA = ca.get(key);
    const inB = cb.get(key);
    const fromQty = inA?.qty ?? 0;
    const toQty = inB?.qty ?? 0;
    // Prefer B's card object for display when present (newer/edited side).
    const card = (inB ?? inA)!.card;
    const isCommander = (inB ?? inA)!.isCommander;
    const delta: CardDelta = { card, isCommander, fromQty, toQty };
    if (fromQty === 0) added.push(delta);
    else if (toQty === 0) removed.push(delta);
    else if (fromQty !== toQty) changed.push(delta);
    else unchangedCount += 1;
  }

  const byName = (x: CardDelta, y: CardDelta) => x.card.name.localeCompare(y.card.name);
  added.sort(byName);
  removed.sort(byName);
  changed.sort(byName);
  return { added, removed, changed, unchangedCount };
}

export interface PriceDiff {
  aTotal: number;
  bTotal: number;
  /** bTotal − aTotal. Positive = B is more expensive. */
  delta: number;
}

/** Total per deck (all copies incl. commanders) and the B − A delta, in the
 *  given display currency. */
export function diffDeckPrice(a: Deck, b: Deck, currency: 'USD' | 'EUR' = 'USD'): PriceDiff {
  const total = (deck: Deck) => {
    let sum = 0;
    for (const { card, qty } of countCards(deck).values()) sum += cardPrice(card, currency) * qty;
    return sum;
  };
  const aTotal = total(a);
  const bTotal = total(b);
  return { aTotal, bTotal, delta: bTotal - aTotal };
}

export interface DeckBracket {
  /** Effective bracket 1–5 (override-wins), or undefined if never analyzed. */
  bracket: number | undefined;
  /** Letter grade, or undefined if never analyzed. */
  gradeLetter: string | undefined;
}

export interface BracketDiff {
  a: DeckBracket;
  b: DeckBracket;
}

/** Persisted bracket/grade for each deck (read-only — never recomputed here). */
export function diffDeckBracket(a: Deck, b: Deck): BracketDiff {
  const read = (deck: Deck): DeckBracket => ({
    bracket: effectiveBracket(deck),
    gradeLetter: deck.deckGrade?.letter,
  });
  return { a: read(a), b: read(b) };
}

/** A numeric stat with both decks' values and the B − A delta. */
export interface StatDelta {
  a: number;
  b: number;
  delta: number;
}

const stat = (a: number, b: number): StatDelta => ({ a, b, delta: b - a });

/** Per-CMC bucket counts (aligned by cmc) plus the average-CMC delta. */
export interface CurveDiff {
  buckets: { cmc: number; delta: StatDelta }[];
  averageCmc: StatDelta;
}

function diffCurve(a: CurveBucket[], b: CurveBucket[], avgA: number, avgB: number): CurveDiff {
  const countAt = (buckets: CurveBucket[], cmc: number) =>
    buckets.find((x) => x.cmc === cmc)?.count ?? 0;
  const cmcs = [...new Set([...a, ...b].map((x) => x.cmc))].sort((x, y) => x - y);
  return {
    buckets: cmcs.map((cmc) => ({ cmc, delta: stat(countAt(a, cmc), countAt(b, cmc)) })),
    averageCmc: stat(avgA, avgB),
  };
}

const TYPE_KEYS = [
  'creatures',
  'instants',
  'sorceries',
  'artifacts',
  'enchantments',
  'planeswalkers',
  'battles',
  'lands',
  'other',
] as const;

export type TypeDiff = Record<(typeof TYPE_KEYS)[number], StatDelta>;

function diffTypes(a: TypeBreakdown, b: TypeBreakdown): TypeDiff {
  return Object.fromEntries(TYPE_KEYS.map((k) => [k, stat(a[k], b[k])])) as TypeDiff;
}

/** Role count delta aligned by role key (ramp/draw/removal/…/lands). */
export interface RoleDiff {
  key: string;
  label: string;
  delta: StatDelta;
}

function diffRoles(a: RoleHealth[], b: RoleHealth[]): RoleDiff[] {
  const countOf = (roles: RoleHealth[], key: string) =>
    roles.find((r) => r.key === key)?.count ?? 0;
  const keys = [...new Set([...a, ...b].map((r) => r.key))];
  return keys.map((key) => {
    const label = a.find((r) => r.key === key)?.label ?? b.find((r) => r.key === key)?.label ?? key;
    return { key, label, delta: stat(countOf(a, key), countOf(b, key)) };
  });
}

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

/** Card counts per color (a card counts once per color in its identity) + colorless. */
export type ColorDiff = Record<(typeof COLORS)[number] | 'C', StatDelta>;

function colorCounts(deck: Deck): Record<string, number> {
  const counts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const { card, qty } of countCards(deck).values()) {
    const ci = card.color_identity ?? [];
    if (ci.length === 0) counts.C += qty;
    else for (const c of ci) if (c in counts) counts[c] += qty;
  }
  return counts;
}

function diffColors(a: Deck, b: Deck): ColorDiff {
  const ca = colorCounts(a);
  const cb = colorCounts(b);
  return Object.fromEntries([...COLORS, 'C'].map((c) => [c, stat(ca[c], cb[c])])) as ColorDiff;
}

export interface StatDiff {
  /** Mainboard size (non-commander) delta. */
  size: StatDelta;
  curve: CurveDiff;
  types: TypeDiff;
  roles: RoleDiff[];
  colors: ColorDiff;
  /** True only when both analyses had tagger data — role deltas are meaningless otherwise. */
  taggerReady: boolean;
}

const toInput = (deck: Deck) => ({
  format: deck.format,
  commander: deck.commander,
  partnerCommander: deck.partnerCommander,
  mainboard: deck.cards.map((s) => ({ slotId: s.slotId, card: s.card })),
});

/** Stat-delta over the existing `analyzeDeck` engine. `taggerReady` gates roles. */
export function diffDeckStats(a: Deck, b: Deck, taggerReady: boolean): StatDiff {
  const ra: DeckAnalysisResult = analyzeDeck(toInput(a), taggerReady);
  const rb: DeckAnalysisResult = analyzeDeck(toInput(b), taggerReady);
  return {
    size: stat(ra.totalNonCommander, rb.totalNonCommander),
    curve: diffCurve(ra.curve.buckets, rb.curve.buckets, ra.curve.averageCmc, rb.curve.averageCmc),
    types: diffTypes(ra.types, rb.types),
    roles: diffRoles(ra.roles, rb.roles),
    colors: diffColors(a, b),
    taggerReady: ra.taggerReady && rb.taggerReady,
  };
}

export interface DeckDiff {
  cards: CardListDiff;
  stats: StatDiff;
  price: PriceDiff;
  bracket: BracketDiff;
}

/** Full A → B comparison across every dimension. The one call the UI needs. */
export function diffDecks(
  a: Deck,
  b: Deck,
  taggerReady: boolean,
  currency: 'USD' | 'EUR' = 'USD'
): DeckDiff {
  return {
    cards: diffDeckCards(a, b),
    stats: diffDeckStats(a, b, taggerReady),
    price: diffDeckPrice(a, b, currency),
    bracket: diffDeckBracket(a, b),
  };
}
