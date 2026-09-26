import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';
import { availableFinishes } from './scanner-feedback';

export const FINISH_LABEL: Record<Finish, string> = {
  nonfoil: 'Non-foil',
  foil: 'Foil',
  etched: 'Etched',
};

/**
 * The confirmation every collection add shows: exactly what landed, down to
 * the printing and finish. A quick add names no finish, so this reports the
 * one the store gives it (the printing's first finish), never a blank.
 */
export function addedCardMessage(
  card: ScryfallCard,
  qty: number,
  finish?: Finish,
  pinned = false
): string {
  const landed = finish ?? availableFinishes(card.finishes)[0];
  const detail = [
    `${card.set.toUpperCase()} #${card.collector_number}`,
    FINISH_LABEL[landed],
    ...(pinned ? ['pinned to this binder'] : []),
  ];
  return `Added ${qty > 1 ? `${qty} × ` : ''}${card.name} · ${detail.join(' · ')}`;
}
