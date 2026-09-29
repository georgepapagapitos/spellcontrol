/**
 * The one module scripts/deck-objective-eval.mjs imports.
 *
 * Vite's `runnerImport` builds a separate module graph per call, and the
 * state the objective reads is module-global (the card-facts snapshot, the
 * tagger's tag sets, the EDHREC client's page cache). Importing each piece
 * separately would load facts into one copy of `cardFacts/index.ts` and read
 * them from another. Everything the evaluator touches is re-exported here so
 * it is one graph.
 */
export * from './index';
export * from './panelDump';
export * from './validation';
export * from './optimizer';
export * from './panelRewrite';
export { setCardFactsSnapshot, hasCardFacts } from '@/deck-builder/services/cardFacts';
export { loadTaggerData, hasTaggerData } from '@/deck-builder/services/tagger/client';
export {
  fetchCommanderData,
  fetchCommanderThemeData,
  fetchPartnerCommanderData,
  fetchPartnerThemeData,
  fetchCardLiftPool,
  formatCommanderNameForUrl,
} from '@/deck-builder/services/edhrec/client';
export { HARDCODED_GAME_CHANGERS } from '@spellcontrol/deck-metrics';
