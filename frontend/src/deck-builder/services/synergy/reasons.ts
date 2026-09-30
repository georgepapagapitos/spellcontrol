/**
 * Classifier reasons whose condition is narrower than their axis: a payoff
 * that needs a specific producer (or board) the axis alone doesn't promise.
 * The off-meta suggester checks the deck enables them (suggest.ts, T171
 * round 3).
 */
export const REASON = {
  convoke: 'has convoke',
  forcesDiscards: 'forces discards',
  loots: 'loots or rummages',
  punishesOpponentDiscard: 'punishes opponents discarding',
  rewardsYourDiscards: 'rewards your discards',
  madness: 'madness',
  loyaltyEngine: 'a loyalty engine',
} as const;
