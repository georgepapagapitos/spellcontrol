/**
 * Card quality, the objective's prior: how many of this page's decks play
 * each card. A PRIOR, not a verdict: every other term can outvote it, and an
 * off-page card is read from the page floor and its power peers (context.ts
 * OFF_PAGE_TRUST), never as 0.
 *
 * quality   Σ q over the 99, q = inclusion share (0.52 for a 52% card).
 *           Swapping a 52% card for a 20% one costs 0.32 card-equivalents.
 *           Basic lands read 0: they are mana, scored by the mana term.
 * signature Σ E510 synergy strength (synergyLift.ts: shrunk rate × log2
 *           lift) × SIGNATURE_SCALE, clamped. The commander-specific part of
 *           a card's play rate, kept as its own term so it can be weighed
 *           (and ablated) apart from raw popularity: E510 promoted it as a
 *           generation priority and regressed 12/31 decks through slot
 *           displacement, which a whole-deck score is meant to see.
 */
import type { CardNote } from '../types';
import { pct, round2, type TermFn } from './shared';

/** Card-equivalents per unit of E510 strength (Spore Frog in Meren reads 2.86 → 0.29). */
export const SIGNATURE_SCALE = 0.1;
/** Strength is clamped: below −1 is noise on thin pages, above 3 is a handful of signature cards. */
export const SIGNATURE_MIN = -1;
export const SIGNATURE_MAX = 3;

export const qualityTerm: TermFn = (deck, ctx) => {
  const notes: CardNote[] = [];
  let value = 0;
  let onPage = 0;
  let offPage = 0;
  for (const card of deck.cards) {
    const read = ctx.qualityOf(card);
    if (read.source === 'basic') continue;
    value += read.q;
    if (read.source === 'page') onPage++;
    else offPage++;
    notes.push({ name: card.name, value: read.q, note: read.note });
  }
  return {
    value,
    summary: `${onPage} cards on the page, ${offPage} off it (page floor ${pct(ctx.pageFloorPct / 100)}), mean read ${pct(notes.length ? value / notes.length : 0)}`,
    cards: notes,
  };
};

export const signatureTerm: TermFn = (deck, ctx) => {
  const notes: CardNote[] = [];
  let value = 0;
  for (const card of deck.cards) {
    const read = ctx.qualityOf(card);
    if (read.strength == null || read.strength === 0) continue;
    const s = Math.min(SIGNATURE_MAX, Math.max(SIGNATURE_MIN, read.strength));
    const v = s * SIGNATURE_SCALE;
    value += v;
    notes.push({
      name: card.name,
      value: v,
      note:
        read.strength >= 0
          ? `plays ${round2(read.strength)} strength over its colors`
          : `this commander's players avoid it (strength ${round2(read.strength)})`,
    });
  }
  return {
    value,
    summary: `${notes.length} cards with a synergy reading, net strength ${round2(value / SIGNATURE_SCALE)}`,
    cards: notes,
  };
};
