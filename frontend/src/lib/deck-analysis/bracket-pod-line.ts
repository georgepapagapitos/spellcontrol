import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import {
  bracketLabel,
  ratingOnlyComboFloor,
} from '@/deck-builder/services/deckBuilder/bracketEstimator';

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * The one sentence an owner reads out (or pastes) before a game: the bracket
 * and the facts a pod asks about, built from the same estimate the Bracket
 * panel shows. Speaks in the owner's voice once they've stated a bracket the
 * estimate disagrees with.
 */
export function bracketPodLine(
  est: BracketEstimation,
  stated: number | null,
  borderline: number | null
): string {
  const b = est.breakdown;
  const parts: string[] = [];

  if (stated != null && stated !== est.bracket) {
    parts.push(`I play this at Bracket ${stated}; the app estimates ${est.bracket}.`);
  } else {
    const at = stated ?? est.bracket;
    parts.push(
      `Bracket ${at} (${bracketLabel(at)})${borderline != null ? `, borderline ${borderline}` : ''}.`
    );
  }

  const absent: string[] = [];

  if (b.gameChangerCount > 0) {
    parts.push(`${count(b.gameChangerCount, 'Game Changer')}: ${b.gameChangerNames.join(', ')}.`);
  } else absent.push('Game Changers');

  const ruthless = ratingOnlyComboFloor(est)?.ruthlessCombos;
  const combos = b.twoCardComboCount + b.multiCardComboCount;
  if (ruthless) {
    const more = combos - 1;
    parts.push(
      more > 0
        ? `Infinite combos: ${ruthless[0].join(' + ')} and ${more} more.`
        : `Infinite combo: ${ruthless[0].join(' + ')}.`
    );
  } else if (combos > 0) {
    parts.push(`${count(combos, 'infinite combo')}.`);
  } else absent.push('infinite combos');

  if (b.massLandDenialCount > 0) {
    parts.push(`Mass land denial: ${b.massLandDenialNames.join(', ')}.`);
  } else absent.push('mass land denial');

  if (b.extraTurnCount > 0) parts.push(`${count(b.extraTurnCount, 'extra turn card')}.`);
  else absent.push('extra turns');

  if (est.hardFloors.some((f) => /stax/i.test(f.reason))) {
    parts.push(`${count(b.staxPieceCount, 'stax piece')}.`);
  }

  if (absent.length > 0) parts.push(`No ${absent.join(', no ')}.`);
  return parts.join(' ');
}
