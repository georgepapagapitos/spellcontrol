/**
 * The EDHREC page a deck was built from, so Coach reads the same one.
 *
 * Generation pulls its pool from a theme page (a Zombies Gisa deck), a
 * bracket page (a Bracket 4 Yuriko) or a budget page, and records which in
 * `buildReport.dataSource` and its saved settings. The manual-deck analysis
 * always read the commander's base page, so a 62% Zombie lord on the theme
 * page read as a 0% misfit, cut reasons quoted the wrong page, and the 40%
 * commander-staple protection never fired: the blind gate's main regression
 * class (T171 lane M, re-gate). A hand-built deck has no source and keeps the
 * base page.
 */
import type {
  BudgetOption,
  DeckDataSource,
  EDHRECCommanderData,
  ScryfallCard,
  TargetBracket,
  ThemeResult,
} from '@/deck-builder/types';
import type { Deck } from '@/store/decks';
import {
  fetchCommanderData,
  fetchPartnerCommanderData,
} from '@/deck-builder/services/edhrec/client';
import { fetchMergedThemeData } from './deckGeneration/themePages';

export interface DeckEdhrecSource {
  /** The theme pages the pool came from; empty = the commander's own page. */
  themes: ThemeResult[];
  budgetOption?: BudgetOption;
  targetBracket?: TargetBracket;
}

type NumericBracket = Exclude<TargetBracket, 'all'>;

/**
 * The source a generated deck was built from, read off its saved settings and
 * the rung its build report records. Undefined for a hand-built deck.
 */
export function deckEdhrecSource(
  deck: Pick<Deck, 'generationContext'> & { buildReport?: { dataSource?: DeckDataSource } }
): DeckEdhrecSource | undefined {
  const gc = deck.generationContext;
  if (!gc) return undefined;
  const c = gc.customization ?? {};
  const rung = deck.buildReport?.dataSource;
  const themes = (gc.selectedThemes ?? []).filter((t) => !!t.slug);
  const bracketSetting = c.targetBracket ?? gc.targetBracket;
  const bracket =
    typeof bracketSetting === 'number' ? (bracketSetting as NumericBracket) : undefined;
  const budgetOption = c.budgetOption && c.budgetOption !== 'any' ? c.budgetOption : undefined;
  // The rung says which page the pool settled on (E93's ladder can drop the
  // theme or the bracket); an older deck without one replays its settings.
  const useThemes = rung ? rung === 'theme' || rung === 'theme+bracket' : themes.length > 0;
  const useBracket = rung ? rung === 'theme+bracket' || rung === 'base+bracket' : !!bracket;
  return {
    themes: useThemes ? themes : [],
    budgetOption,
    targetBracket: useBracket ? bracket : undefined,
  };
}

/**
 * The page for `source`: the merged theme pages when it names themes, else
 * the commander's page at its budget and bracket. A theme or bracket page that
 * fails to load falls back to the base page, never to no analysis.
 */
export async function fetchDeckEdhrecPage(
  commander: ScryfallCard,
  partner: ScryfallCard | null | undefined,
  source: DeckEdhrecSource | undefined
): Promise<EDHRECCommanderData> {
  const base = () =>
    partner
      ? fetchPartnerCommanderData(commander.name, partner.name)
      : fetchCommanderData(commander.name);
  if (!source) return base();
  try {
    if (source.themes.length > 0) {
      const merged = await fetchMergedThemeData(
        source.themes,
        commander.name,
        partner?.name,
        source.budgetOption,
        source.targetBracket
      );
      if (merged && merged.data.cardlists.allNonLand.length > 0) return merged.data;
      return base();
    }
    if (!source.budgetOption && !source.targetBracket) return base();
    const page = await (partner
      ? fetchPartnerCommanderData(
          commander.name,
          partner.name,
          source.budgetOption,
          source.targetBracket
        )
      : fetchCommanderData(commander.name, source.budgetOption, source.targetBracket));
    return page.cardlists.allNonLand.length > 0 ? page : base();
  } catch {
    return base();
  }
}
