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
  everySpell: 'adds mana for every spell',
} as const;

/**
 * A cast trigger the spellslinger engine pays off: an instant or sorcery, or
 * mana for any spell cast (Birgi, God of Storytelling; T171 round 3). Other
 * any-spell triggers (Aetherflux Reservoir's life) stay with their own axis.
 */
export const CAST_TRIGGER =
  /whenever you cast (?:or copy )?(?:an? )?(instant|sorcery|spell(?=, add\b))/;
