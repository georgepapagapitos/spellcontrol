import type { ScryfallCard } from '@/deck-builder/types';
import { classifyCard } from '@/deck-builder/services/synergy/classify';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';

// Axes where a payoff is usually dead text unless the deck has a producer for
// the same engine. Generic roles like "draw" or "ramp" are deliberately not
// considered here; this gates the trigger condition, not the reward.
const DEPENDENCY_AXES = new Set<AxisKey>([
  'graveyard',
  'sacrifice',
  'lifegain',
  'landfall',
  'artifacts',
  'equipment',
  'spellslinger',
  'enchantress',
  'discard',
  'mill',
  'poison',
  'cycling',
  'venture',
  'energy',
  'auras',
  'vehicles',
]);

const GY_LEAVE_KEYWORDS = new Set([
  'delve',
  'escape',
  'flashback',
  'jump-start',
  'disturb',
  'unearth',
  'embalm',
  'eternalize',
  'aftermath',
  'retrace',
  'scavenge',
]);

const DEFAULT_SUPPORT_THRESHOLD = 3;

function combinedOracle(card: ScryfallCard): string {
  const parts = [
    card.oracle_text ?? '',
    ...(card.card_faces ?? []).map((f) => f.oracle_text ?? ''),
  ];
  return parts
    .join('\n')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function enablesOwnGraveyardLeave(card: ScryfallCard): boolean {
  if ((card.keywords ?? []).some((kw) => GY_LEAVE_KEYWORDS.has(kw.toLowerCase()))) return true;

  const oracle = combinedOracle(card);
  return (
    /\bspells you cast have delve\b/.test(oracle) ||
    /\b(?:cast|play|return|put|exile) [^.]* from your graveyard\b/.test(oracle) ||
    /\bfrom your graveyard (?:to|onto) the battlefield\b/.test(oracle) ||
    /\bexile [^.]* cards? from your graveyard\b/.test(oracle)
  );
}

function isRepeatable(card: ScryfallCard): boolean {
  const oracle = combinedOracle(card);
  return (
    /\bat the beginning of\b|\bwhenever\b|\bwhenever one or more\b|\bactivated ability\b/.test(
      oracle
    ) ||
    /\byou may (?:cast|play)\b|\b(?:has|have) escape\b/.test(oracle) ||
    /\{t\}:|:\s*(?:add|create|draw|return|exile|sacrifice|discard|mill|venture|proliferate)/.test(
      oracle
    )
  );
}

function isSelfHostileGraveyardLeave(card: ScryfallCard): boolean {
  const oracle = combinedOracle(card);
  return (
    /\bexile all graveyards\b/.test(oracle) ||
    /\bexile target player's graveyard\b/.test(oracle) ||
    /\bexile all cards from all graveyards\b/.test(oracle)
  );
}

function isCheap(card: ScryfallCard): boolean {
  return (card.cmc ?? 99) <= 2;
}

function cardSupportScore(
  card: ScryfallCard,
  axis: AxisKey,
  isCommander: boolean,
  classified = classifyCard(card)
): number {
  const produces =
    classified.producers.some((p) => p.axis === axis) ||
    (axis === 'graveyard' && enablesOwnGraveyardLeave(card));
  if (!produces) return 0;

  if (axis === 'graveyard' && isSelfHostileGraveyardLeave(card)) return 0.25;

  let score = isCommander ? 4 : 1;
  if (isRepeatable(card)) score += isCommander ? 1 : 1.5;
  if (isCheap(card)) score += 0.5;
  return score;
}

function supportScore(
  axis: AxisKey,
  supportCards: readonly ScryfallCard[],
  commanderCount: number
): number {
  let total = 0;
  for (const [index, card] of supportCards.entries()) {
    total += cardSupportScore(card, axis, index < commanderCount);
  }
  return total;
}

export function unsupportedPayoffAxes(
  card: ScryfallCard,
  supportCards: readonly ScryfallCard[],
  commanderCount: number
): AxisKey[] {
  const classified = classifyCard(card);
  const candidateProduces = new Set(classified.producers.map((p) => p.axis));

  const unsupported: AxisKey[] = [];
  for (const payoff of classified.payoffs) {
    if (!DEPENDENCY_AXES.has(payoff.axis)) continue;
    if (candidateProduces.has(payoff.axis)) continue;
    if (supportScore(payoff.axis, supportCards, commanderCount) >= DEFAULT_SUPPORT_THRESHOLD)
      continue;
    if (!unsupported.includes(payoff.axis)) unsupported.push(payoff.axis);
  }
  return unsupported;
}

export function isUnsupportedSynergyPayoff(
  card: ScryfallCard,
  supportCards: readonly ScryfallCard[],
  commanderCount = 1
): boolean {
  return unsupportedPayoffAxes(card, supportCards, commanderCount).length > 0;
}
