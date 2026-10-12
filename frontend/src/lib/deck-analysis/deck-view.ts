/** The page-top analysis view ids. (Test hand is a separate standalone panel,
 *  not a view — goldfishing is a distinct activity.) */
export type AnalysisTabId = 'stats' | 'power' | 'tune';

/** The full page-top view set: the card-list editing surface plus the analysis
 *  views. `DeckEditorPage` owns this state and renders the hub tab bar. */
export type DeckView = 'deck' | AnalysisTabId;

/** The screen-reader heading for each view. */
export const VIEW_HEADINGS: Record<DeckView, string> = {
  deck: 'Deck',
  stats: 'Deck stats',
  power: 'Power',
  tune: 'Coach',
};
