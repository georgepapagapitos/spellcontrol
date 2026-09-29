/**
 * Nonbos: cards that fight the deck's own plan, read by the existing
 * coherence detectors so the objective and the deck page agree on what a
 * nonbo is (nonbo.ts, E80/E106):
 *
 * - hard nonbos (warn): a continuous symmetric effect that switches off an
 *   engine the deck is invested in (Rest in Peace in a graveyard deck, Torpor
 *   Orb beside ETB value): HARD_NONBO card-equivalents each;
 * - tensions (info): a symmetric wipe that sweeps the deck's own go-wide
 *   board (Toxic Deluge beside a token army), a graveyard wipe in a graveyard
 *   deck: TENSION each;
 * - qualified payoffs the deck can barely feed ("another black creature" in
 *   a colorless token deck): QUALIFIED each.
 *
 * Investment is analyzeDeckSynergy's (commanders included), as in the audit.
 */
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { nonboFindings, qualifiedTriggerFindings } from '../../nonbo';
import type { CardNote } from '../types';
import { nonLandCards, type TermFn } from './shared';

export const HARD_NONBO = 1;
export const TENSION = 0.5;
export const QUALIFIED = 0.3;

export const nonboTerm: TermFn = (deck) => {
  const spells = nonLandCards(deck);
  const invested = new Set<string>(analyzeDeckSynergy([...deck.commanders, ...spells]).invested);
  const notes: CardNote[] = [];
  for (const f of nonboFindings(spells, invested)) {
    if (!f.card) continue;
    notes.push({
      name: f.card,
      value: -(f.severity === 'warn' ? HARD_NONBO : TENSION),
      note: f.message,
    });
  }
  for (const f of qualifiedTriggerFindings(spells)) {
    if (!f.card) continue;
    notes.push({ name: f.card, value: -QUALIFIED, note: f.message });
  }
  const value = notes.reduce((s, n) => s + n.value, 0);
  return {
    value,
    summary: notes.length
      ? `${notes.length} cards fight the plan (invested in ${[...invested].join(', ') || 'nothing'})`
      : `no nonbo (invested in ${[...invested].join(', ') || 'nothing'})`,
    cards: notes,
  };
};
