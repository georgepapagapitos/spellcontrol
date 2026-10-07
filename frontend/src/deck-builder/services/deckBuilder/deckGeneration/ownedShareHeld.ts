/**
 * How many of the deck's unowned nonland cards the owned-share swap may not
 * take (E571): the reason the gap note gives when a partial share falls short.
 * Undefined outside a partial build.
 */
import { shareKeeper } from '../ownedShareEviction';
import type { GenerationState } from './state';

export function ownedShareHeld(
  state: Pick<
    GenerationState,
    'combos' | 'usedNames' | 'comboCardNames' | 'cfg' | 'edhrecData' | 'categories' | 'context'
  >
): number | undefined {
  const names = state.context.collectionNames;
  if (state.cfg.collectionStrategy !== 'partial' || !names) return undefined;
  const keeps = shareKeeper(state);
  return Object.entries(state.categories)
    .filter(([cat]) => cat !== 'lands')
    .flatMap(([, cards]) => cards)
    .filter((card) => !names.has(card.name) && keeps(card)).length;
}
