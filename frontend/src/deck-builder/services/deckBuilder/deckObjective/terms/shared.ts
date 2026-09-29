/**
 * Helpers shared by the objective's terms.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
import type { CardNote, ObjectiveContext, ObjectiveDeck, TermResult } from '../types';
import { isLandCard } from '../context';

/** The 99 without lands: every card that fills a spell slot (an MDFC spell // land is a spell). */
export function nonLandCards(deck: ObjectiveDeck): ScryfallCard[] {
  return deck.cards.filter((c) => !isLandCard(c));
}

/** A term's value with its cards, before the weight is applied. */
export interface TermValue {
  value: number;
  summary: string;
  cards: CardNote[];
}

/** Sort cards by |value| (largest first), then name, so details are stable. */
export function sortNotes(notes: CardNote[]): CardNote[] {
  return notes.sort(
    (a, b) => Math.abs(b.value) - Math.abs(a.value) || a.name.localeCompare(b.name)
  );
}

export function finishTerm(v: TermValue, weight: number): TermResult {
  return {
    value: v.value,
    weight,
    contribution: v.value * weight,
    detail: { summary: v.summary, cards: sortNotes(v.cards) },
  };
}

/** x² / (x² + w²): 0 at 0, 0.5 at w, → 1 as x grows. A soft penalty that saturates. */
export function softSat(x: number, width: number): number {
  if (x <= 0) return 0;
  return (x * x) / (x * x + width * width);
}

/** 1 − e^(−x/k): diminishing returns on a supply. */
export function expSat(x: number, k: number): number {
  return x <= 0 ? 0 : 1 - Math.exp(-x / k);
}

/** Name keys a card answers to: its full name and its front face, lowercased. */
export function nameKeys(name: string): string[] {
  const full = name.toLowerCase();
  const front = frontFaceName(name).toLowerCase();
  return full === front ? [full] : [full, front];
}

/** Every name key in the deck, commanders included. */
export function deckNameKeys(deck: ObjectiveDeck): Set<string> {
  const keys = new Set<string>();
  for (const c of [...deck.commanders, ...deck.cards])
    for (const k of nameKeys(c.name)) keys.add(k);
  return keys;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Percent with no trailing zeros ("12%", "12.5%"). */
export function pct(share: number): string {
  return `${Math.round(share * 1000) / 10}%`;
}

export type TermFn = (deck: ObjectiveDeck, ctx: ObjectiveContext) => TermValue;
