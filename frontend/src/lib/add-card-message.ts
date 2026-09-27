import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';
import { FINISH_LABELS, availableFinishes } from './scanner-feedback';
import { useScannerSettings } from './scanner-settings';

/**
 * The finish an add lands as. A named finish is used as given. With none, a
 * quick add (the "+" on a result) takes the Add settings default when this
 * printing was made in it; anything else, or a printing without it, takes the
 * printing's first finish. The store saves with this and the toast reports
 * with it, so the two can't disagree: the toast used to work the finish out
 * on its own and said "Non-foil" over a copy saved as foil.
 */
export function landedFinish(card: ScryfallCard, finish?: Finish, quickAdd = false): Finish {
  if (finish) return finish;
  const made = availableFinishes(card.finishes);
  const preferred = quickAdd ? useScannerSettings.getState().defaultFinish : undefined;
  return preferred && made.includes(preferred) ? preferred : made[0];
}

/**
 * The confirmation every collection add shows: exactly what landed, down to
 * the printing and finish (`landedFinish`, the same call the store makes).
 */
export function addedCardMessage(
  card: ScryfallCard,
  qty: number,
  finish?: Finish,
  pinned = false,
  quickAdd = false
): string {
  const landed = landedFinish(card, finish, quickAdd);
  const detail = [
    `${card.set.toUpperCase()} #${card.collector_number}`,
    FINISH_LABELS[landed],
    ...(pinned ? ['pinned to this binder'] : []),
  ];
  return `Added ${qty > 1 ? `${qty} × ` : ''}${card.name} · ${detail.join(' · ')}`;
}
